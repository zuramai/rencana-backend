import { sql as rawSql } from 'drizzle-orm'
import { hashPassword } from '../../src/auth/passwords.ts'
import { db } from '../../src/db/client.ts'
import { files, plans, users } from '../../src/db/schema.ts'

export const WEB = 'http://localhost:3000'
export const JSON_HEADERS = { 'Content-Type': 'application/json' }

export async function resetDb(): Promise<void> {
  await db.execute(rawSql`truncate table users cascade`)
}

export async function createUser(username: string, password = 'travel1234', passwordHash?: string) {
  const [row] = await db.insert(users).values({
    username,
    passwordHash: passwordHash ?? await hashPassword(password),
    displayName: username,
    locale: 'en',
    defaultCurrency: 'IDR'
  }).returning()
  return row!
}

export async function createPlanWithFile(userId: string) {
  const [file] = await db.insert(files).values({
    userId, s3Key: `u/${userId}/x.jpg`, contentType: 'image/jpeg', byteSize: 1, originalName: 'x.jpg'
  }).returning()
  const [plan] = await db.insert(plans).values({
    userId, name: 'Secret trip', coverType: 'image', coverFileId: file!.id, budgetCurrency: 'IDR'
  }).returning()
  return { plan: plan!, file: file! }
}

/** `name=value` pairs from the response's Set-Cookie headers (empty value = cleared). */
export function cookiesOf(res: Response): Record<string, { value: string, raw: string }> {
  const out: Record<string, { value: string, raw: string }> = {}
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(';')
    const index = pair!.indexOf('=')
    out[pair!.slice(0, index)] = { value: pair!.slice(index + 1), raw }
  }
  return out
}
