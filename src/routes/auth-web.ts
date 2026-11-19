import { Hono } from 'hono'
import { loginInput, registerInput } from '#shared/schemas/auth'
import { authenticate, limitLogin, registerUser } from '../auth/accounts.ts'
import { clearSessionCookie, getSessionCookie, setSessionCookie } from '../auth/cookies.ts'
import { requireTrustedOrigin } from '../auth/middleware.ts'
import { createWebSession, resolveToken, revokeSession } from '../auth/sessions.ts'
import type { Limiters } from '../http/limits.ts'
import { clientIp, enforce } from '../http/rate-limit.ts'
import { parseJson } from '../http/validate.ts'
import { sessionUser } from '../lib/users.ts'
import type { Context } from 'hono'
import type { AppEnv } from '../types.ts'

/** Drops the session behind a presented cookie (session fixation / rotation). */
async function revokePresented(c: Context): Promise<void> {
  const token = getSessionCookie(c)
  const found = token ? await resolveToken(token, 'web') : null
  if (found) await revokeSession(found.session.id)
}

export function authWebRoutes(limiters: Limiters) {
  const router = new Hono<AppEnv>()

  router.use('*', async (c, next) => {
    requireTrustedOrigin(c)
    await next()
  })

  router.post('/register', async (c) => {
    enforce(limiters.register, clientIp(c))
    const body = await parseJson(c, registerInput)
    const row = await registerUser(body, c.req.header('accept-language'))
    await revokePresented(c)
    setSessionCookie(c, await createWebSession(row.id, c.req.header('user-agent')))
    return c.json(sessionUser(row))
  })

  router.post('/login', async (c) => {
    await limitLogin(c, limiters)
    const body = await parseJson(c, loginInput)
    const row = await authenticate(body)
    await revokePresented(c)
    setSessionCookie(c, await createWebSession(row.id, c.req.header('user-agent')))
    return c.json(sessionUser(row))
  })

  router.post('/logout', async (c) => {
    await revokePresented(c)
    clearSessionCookie(c)
    return c.json({ ok: true })
  })

  return router
}
