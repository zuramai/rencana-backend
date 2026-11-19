import { Hono, type Context } from 'hono'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getSessionCookie, setOAuthCookie, setSessionCookie, takeOAuthCookie, type OAuthState } from '../auth/cookies.ts'
import { randomToken, safeEqual, sha256B64url, sha256Hex } from '../auth/crypto.ts'
import { exchangeGoogleCode, googleAuthorizeUrl } from '../auth/google.ts'
import { createWebSession, resolveToken, revokeSession } from '../auth/sessions.ts'
import { db } from '../db/client.ts'
import { oauthCodes, users } from '../db/schema.ts'
import { env } from '../env.ts'
import type { Limiters } from '../http/limits.ts'
import { clientIp, enforce } from '../http/rate-limit.ts'
import { detectCurrency } from '../lib/currency.ts'
import type { AppEnv } from '../types.ts'

const MOBILE_CALLBACK = 'com.zuramai.rencana:/oauth/callback'
const CODE_TTL_MS = 60_000

const startQuery = z.object({
  client: z.enum(['web', 'mobile']),
  locale: z.enum(['en', 'id']).default('en'),
  tz: z.string().max(64).optional(),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  state: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional()
}).superRefine((q, ctx) => {
  if (q.client === 'mobile' && (!q.code_challenge || !q.state)) {
    ctx.addIssue({ code: 'custom', path: ['code_challenge'], message: 'required for mobile' })
  }
})

function errorTarget(client: OAuthState['c'] | undefined, appState: string | undefined): string {
  if (client === 'mobile' && appState) return `${MOBILE_CALLBACK}?${new URLSearchParams({ error: 'google', state: appState })}`
  return `${env.WEB_APP_URL}/login?error=google`
}

async function findOrCreateUser(c: Context, state: OAuthState, profile: Awaited<ReturnType<typeof exchangeGoogleCode>>) {
  const existing = await db.query.users.findFirst({ where: eq(users.googleSub, profile.sub) })
  if (existing) return existing
  const [row] = await db.insert(users).values({
    googleSub: profile.sub,
    email: profile.email,
    displayName: profile.name ?? profile.email ?? 'Traveler',
    avatarUrl: profile.picture,
    locale: state.l,
    defaultCurrency: detectCurrency(state.tz, c.req.header('accept-language'))
  }).onConflictDoUpdate({ target: users.googleSub, set: { email: profile.email } }).returning()
  return row!
}

export function googleRoutes(limiters: Limiters) {
  const router = new Hono<AppEnv>()

  router.get('/', async (c) => {
    enforce(limiters.token, clientIp(c))
    const query = startQuery.parse(c.req.query())
    if (!env.googleEnabled) return c.redirect(errorTarget(query.client, query.state), 302)
    const state: OAuthState = {
      s: randomToken(),
      n: randomToken(),
      v: randomToken(),
      c: query.client,
      as: query.client === 'mobile' ? query.state : undefined,
      ac: query.client === 'mobile' ? query.code_challenge : undefined,
      l: query.locale,
      tz: query.tz
    }
    await setOAuthCookie(c, state)
    return c.redirect(googleAuthorizeUrl({ state: state.s, nonce: state.n, codeChallenge: sha256B64url(state.v) }), 302)
  })

  router.get('/callback', async (c) => {
    enforce(limiters.token, clientIp(c))
    const state = await takeOAuthCookie(c)
    const returnedState = c.req.query('state') ?? ''
    const code = c.req.query('code')
    if (!state || !safeEqual(returnedState, state.s) || !code || !env.googleEnabled) {
      return c.redirect(errorTarget(state?.c, state?.as), 302)
    }
    let profile
    try {
      profile = await exchangeGoogleCode(code, state.v, state.n)
    } catch (error) {
      console.warn(c.get('requestId'), '[google]', error instanceof Error ? error.message : error)
      return c.redirect(errorTarget(state.c, state.as), 302)
    }
    const user = await findOrCreateUser(c, state, profile)

    if (state.c === 'mobile' && state.as && state.ac) {
      const appCode = randomToken()
      await db.insert(oauthCodes).values({
        codeHash: sha256Hex(appCode),
        userId: user.id,
        codeChallenge: state.ac,
        expiresAt: new Date(Date.now() + CODE_TTL_MS)
      })
      return c.redirect(`${MOBILE_CALLBACK}?${new URLSearchParams({ code: appCode, state: state.as })}`, 302)
    }

    const presented = getSessionCookie(c)
    const previous = presented ? await resolveToken(presented, 'web') : null
    if (previous) await revokeSession(previous.session.id)
    setSessionCookie(c, await createWebSession(user.id, c.req.header('user-agent')))
    return c.redirect(`${env.WEB_APP_URL}/travel`, 302)
  })

  return router
}
