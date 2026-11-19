import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { env } from '../env.ts'
import { httpError } from '../http/errors.ts'
import { sessionUser } from '../lib/users.ts'
import type { AppEnv } from '../types.ts'
import { getSessionCookie } from './cookies.ts'
import { resolveToken } from './sessions.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** 403 `forbidden_origin` unless the request carries an allowed `Origin`. */
export function requireTrustedOrigin(c: Context): void {
  const origin = c.req.header('origin')
  if (!origin || !env.WEB_ORIGINS.includes(origin)) throw httpError(403, 'forbidden_origin')
}

/**
 * Bearer token (mobile) when an Authorization header is present, else the
 * session cookie (web). Cookie-authenticated unsafe requests need a trusted Origin.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const authorization = c.req.header('authorization')
  if (authorization !== undefined) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization)
    const found = match ? await resolveToken(match[1]!, 'mobile') : null
    if (!found) throw httpError(401, 'invalid_token', undefined, { 'WWW-Authenticate': 'Bearer error="invalid_token"' })
    c.set('user', sessionUser(found.user))
    c.set('session', found.session)
    c.set('authVia', 'bearer')
    return next()
  }
  const token = getSessionCookie(c)
  const found = token ? await resolveToken(token, 'web') : null
  if (!found) throw httpError(401, 'unauthorized')
  if (!SAFE_METHODS.has(c.req.method)) requireTrustedOrigin(c)
  c.set('user', sessionUser(found.user))
  c.set('session', found.session)
  c.set('authVia', 'cookie')
  return next()
})
