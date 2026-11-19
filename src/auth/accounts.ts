import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { loginInput, registerInput } from '#shared/schemas/auth'
import { db } from '../db/client.ts'
import { users, type UserRow } from '../db/schema.ts'
import { httpError } from '../http/errors.ts'
import type { Limiters } from '../http/limits.ts'
import { clientIp, enforce } from '../http/rate-limit.ts'
import { detectCurrency } from '../lib/currency.ts'
import { hashPassword, verifyDummy, verifyPassword } from './passwords.ts'

/** Pre-body login limits: per IP, then per username (Hono caches the parsed JSON body). */
export async function limitLogin(c: Context, limiters: Limiters): Promise<void> {
  enforce(limiters.loginIp, clientIp(c))
  const body: unknown = await c.req.json().catch(() => null)
  const username = body && typeof body === 'object' && 'username' in body && typeof body.username === 'string'
    ? body.username.trim().toLowerCase()
    : ''
  if (username) enforce(limiters.loginUser, username)
}

/** Username + password login; legacy scrypt hashes are upgraded to argon2id on success. */
export async function authenticate(body: z.output<typeof loginInput>): Promise<UserRow> {
  const row = await db.query.users.findFirst({ where: eq(users.username, body.username) })
  if (!row?.passwordHash) {
    await verifyDummy(body.password)
    throw httpError(401, 'invalid_credentials')
  }
  const { ok, rehash } = await verifyPassword(row.passwordHash, body.password)
  if (!ok) throw httpError(401, 'invalid_credentials')
  if (rehash) {
    await db.update(users).set({ passwordHash: await hashPassword(body.password) }).where(eq(users.id, row.id))
  }
  return row
}

export async function registerUser(body: z.output<typeof registerInput>, acceptLanguage?: string): Promise<UserRow> {
  const existing = await db.query.users.findFirst({ where: eq(users.username, body.username), columns: { id: true } })
  if (existing) throw httpError(409, 'username_taken')
  const [row] = await db.insert(users).values({
    username: body.username,
    passwordHash: await hashPassword(body.password),
    displayName: body.displayName,
    locale: body.locale,
    defaultCurrency: detectCurrency(body.timezone, acceptLanguage)
  }).onConflictDoNothing({ target: users.username }).returning()
  if (!row) throw httpError(409, 'username_taken')
  return row
}
