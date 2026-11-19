import { Hono } from 'hono'
import { and, eq, gt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { loginInput, registerInput } from '#shared/schemas/auth'
import { authenticate, limitLogin, registerUser } from '../auth/accounts.ts'
import { safeEqual, sha256B64url, sha256Hex } from '../auth/crypto.ts'
import { requireAuth } from '../auth/middleware.ts'
import { createMobileSession, revokeSession, rotateRefresh } from '../auth/sessions.ts'
import { db } from '../db/client.ts'
import { oauthCodes, users } from '../db/schema.ts'
import { httpError } from '../http/errors.ts'
import type { Limiters } from '../http/limits.ts'
import { clientIp, enforce } from '../http/rate-limit.ts'
import { parseJson } from '../http/validate.ts'
import { sessionUser } from '../lib/users.ts'
import type { AppEnv } from '../types.ts'

const googleExchange = z.object({
  code: z.string().min(20).max(128),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/)
})
const refreshInput = z.object({ refreshToken: z.string().min(1).max(200) })

export function authMobileRoutes(limiters: Limiters) {
  const router = new Hono<AppEnv>()

  router.post('/register', async (c) => {
    enforce(limiters.register, clientIp(c))
    const body = await parseJson(c, registerInput)
    const row = await registerUser(body, c.req.header('accept-language'))
    const tokens = await createMobileSession(row.id, c.req.header('user-agent'))
    return c.json({ user: sessionUser(row), tokens })
  })

  router.post('/login', async (c) => {
    await limitLogin(c, limiters)
    const body = await parseJson(c, loginInput)
    const row = await authenticate(body)
    const tokens = await createMobileSession(row.id, c.req.header('user-agent'))
    return c.json({ user: sessionUser(row), tokens })
  })

  router.post('/google', async (c) => {
    enforce(limiters.token, clientIp(c))
    const body = await parseJson(c, googleExchange)
    // Single use: the code row is consumed whether or not the verifier matches.
    const [code] = await db.delete(oauthCodes)
      .where(and(eq(oauthCodes.codeHash, sha256Hex(body.code)), gt(oauthCodes.expiresAt, sql`now()`)))
      .returning()
    if (!code || !safeEqual(sha256B64url(body.codeVerifier), code.codeChallenge)) throw httpError(400, 'invalid_grant')
    const row = await db.query.users.findFirst({ where: eq(users.id, code.userId) })
    if (!row) throw httpError(400, 'invalid_grant')
    const tokens = await createMobileSession(row.id, c.req.header('user-agent'))
    return c.json({ user: sessionUser(row), tokens })
  })

  router.post('/refresh', async (c) => {
    enforce(limiters.token, clientIp(c))
    const { refreshToken } = await parseJson(c, refreshInput)
    return c.json({ tokens: await rotateRefresh(refreshToken) })
  })

  router.post('/logout', requireAuth, async (c) => {
    if (c.get('authVia') !== 'bearer') throw httpError(401, 'invalid_token')
    await revokeSession(c.get('session').id)
    return c.json({ ok: true })
  })

  return router
}
