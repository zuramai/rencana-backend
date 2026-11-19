import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { meInput } from '#shared/schemas/auth'
import { requireAuth } from '../auth/middleware.ts'
import { db } from '../db/client.ts'
import { users } from '../db/schema.ts'
import { httpError } from '../http/errors.ts'
import { parseJson } from '../http/validate.ts'
import { meDto, sessionUser } from '../lib/users.ts'
import type { AppEnv } from '../types.ts'

export const meRoutes = new Hono<AppEnv>()
meRoutes.use('*', requireAuth)

meRoutes.get('/', async (c) => {
  const row = await db.query.users.findFirst({ where: eq(users.id, c.get('user').id) })
  if (!row) throw httpError(401, 'unauthorized')
  return c.json(meDto(row))
})

meRoutes.patch('/', async (c) => {
  const body = await parseJson(c, meInput)
  const [row] = await db.update(users).set(body).where(eq(users.id, c.get('user').id)).returning()
  if (!row) throw httpError(401, 'unauthorized')
  return c.json(sessionUser(row))
})
