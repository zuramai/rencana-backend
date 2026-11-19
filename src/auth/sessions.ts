import { and, eq, gt, lt, or, sql } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { oauthCodes, sessions, users, type SessionRow, type UserRow } from '../db/schema.ts'
import { httpError } from '../http/errors.ts'
import { randomToken, sha256Hex } from './crypto.ts'

const HOUR = 3600_000
const DAY = 24 * HOUR
const WEB_IDLE = 7 * DAY
const WEB_ABSOLUTE = 30 * DAY
const ACCESS_TTL = 15 * 60_000
const REFRESH_IDLE = 30 * DAY
const MOBILE_ABSOLUTE = 90 * DAY

export type Client = 'web' | 'mobile'

export interface TokenPair {
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  refreshTokenExpiresAt: string
}

const ua = (userAgent: string | undefined) => userAgent?.slice(0, 256) ?? null

export async function createWebSession(userId: string, userAgent?: string): Promise<string> {
  const token = randomToken()
  const now = Date.now()
  await db.insert(sessions).values({
    userId,
    client: 'web',
    tokenHash: sha256Hex(token),
    tokenExpiresAt: new Date(now + WEB_IDLE),
    expiresAt: new Date(now + WEB_ABSOLUTE),
    userAgent: ua(userAgent)
  })
  return token
}

function tokenPair(row: SessionRow, accessToken: string, refreshToken: string): TokenPair {
  return {
    accessToken,
    accessTokenExpiresAt: row.tokenExpiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: row.refreshExpiresAt!.toISOString()
  }
}

export async function createMobileSession(userId: string, userAgent?: string): Promise<TokenPair> {
  const accessToken = randomToken()
  const refreshToken = randomToken()
  const now = Date.now()
  const [row] = await db.insert(sessions).values({
    userId,
    client: 'mobile',
    tokenHash: sha256Hex(accessToken),
    tokenExpiresAt: new Date(now + ACCESS_TTL),
    refreshHash: sha256Hex(refreshToken),
    refreshExpiresAt: new Date(now + REFRESH_IDLE),
    expiresAt: new Date(now + MOBILE_ABSOLUTE),
    userAgent: ua(userAgent)
  }).returning()
  return tokenPair(row!, accessToken, refreshToken)
}

/** Session + user for a presented token, or null. Slides web expiry and `last_used_at` at most hourly. */
export async function resolveToken(token: string, client: Client): Promise<{ session: SessionRow, user: UserRow } | null> {
  if (!token || token.length > 200) return null
  const [found] = await db.select({ session: sessions, user: users }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(
      eq(sessions.tokenHash, sha256Hex(token)),
      eq(sessions.client, client),
      gt(sessions.tokenExpiresAt, sql`now()`),
      gt(sessions.expiresAt, sql`now()`)
    ))
    .limit(1)
  if (!found) return null
  if (Date.now() - found.session.lastUsedAt.getTime() > HOUR) {
    const set = client === 'web'
      ? { lastUsedAt: sql`now()`, tokenExpiresAt: sql`least(now() + interval '7 days', ${sessions.expiresAt})` }
      : { lastUsedAt: sql`now()` }
    await db.update(sessions).set(set).where(eq(sessions.id, found.session.id))
  }
  return found
}

export async function revokeSession(id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id))
}

/**
 * Rotates a mobile refresh token. Reusing an already-rotated refresh token
 * deletes the session (401 `session_revoked`); anything else unknown is 401 `invalid_token`.
 */
export async function rotateRefresh(refreshToken: string): Promise<TokenPair> {
  const h = sha256Hex(refreshToken)
  const accessToken = randomToken()
  const nextRefresh = randomToken()
  const [row] = await db.update(sessions).set({
    tokenHash: sha256Hex(accessToken),
    tokenExpiresAt: sql`now() + interval '15 minutes'`,
    refreshHash: sha256Hex(nextRefresh),
    prevRefreshHash: h,
    refreshExpiresAt: sql`least(now() + interval '30 days', ${sessions.expiresAt})`,
    lastUsedAt: sql`now()`
  }).where(and(
    eq(sessions.client, 'mobile'),
    eq(sessions.refreshHash, h),
    gt(sessions.refreshExpiresAt, sql`now()`),
    gt(sessions.expiresAt, sql`now()`)
  )).returning()
  if (row) return tokenPair(row, accessToken, nextRefresh)

  const reused = await db.delete(sessions).where(eq(sessions.prevRefreshHash, h)).returning({ id: sessions.id })
  if (reused.length > 0) throw httpError(401, 'session_revoked')
  throw httpError(401, 'invalid_token')
}

/** Removes sessions and OAuth codes that can never be used again. */
export async function cleanupExpired(): Promise<void> {
  await db.delete(sessions).where(or(
    lt(sessions.expiresAt, sql`now()`),
    and(eq(sessions.client, 'mobile'), lt(sessions.refreshExpiresAt, sql`now()`)),
    and(eq(sessions.client, 'web'), lt(sessions.tokenExpiresAt, sql`now()`))
  ))
  await db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, sql`now()`))
}
