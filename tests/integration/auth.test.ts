import { Scrypt } from '@adonisjs/hash/drivers/scrypt'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.ts'
import { sha256B64url, sha256Hex } from '../../src/auth/crypto.ts'
import { db } from '../../src/db/client.ts'
import { oauthCodes, users } from '../../src/db/schema.ts'
import { JSON_HEADERS, WEB, cookiesOf, createPlanWithFile, createUser, resetDb } from './helpers.ts'

let app: ReturnType<typeof createApp>

beforeEach(async () => {
  await resetDb()
  app = createApp()
})

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) })

async function mobileLogin(username = 'alice') {
  const res = await post('/api/mobile/auth/login', { username, password: 'travel1234' })
  expect(res.status).toBe(200)
  return (await json(res)).tokens
}

interface Body {
  statusMessage: string
  username: string
  tokens: { accessToken: string, refreshToken: string }
}
const json = async (res: Response) => (await res.json()) as Body
const errorCode = async (res: Response) => (await json(res)).statusMessage

describe('web cookie sessions', () => {
  it('logs in, reads /api/me, and logs out', async () => {
    await createUser('alice')
    const login = await post('/api/auth/login', { username: 'alice', password: 'travel1234' }, { Origin: WEB })
    expect(login.status).toBe(200)
    const cookie = cookiesOf(login).rencana_session!
    expect(cookie.raw).toMatch(/HttpOnly/)
    expect(cookie.raw).toMatch(/SameSite=Strict/)
    expect(cookie.raw).toMatch(/Path=\//)
    const header = { Cookie: `rencana_session=${cookie.value}` }

    const me = await app.request('/api/me', { headers: header })
    expect(me.status).toBe(200)
    expect((await json(me)).username).toBe('alice')

    const logout = await app.request('/api/auth/logout', { method: 'POST', headers: { ...header, Origin: WEB } })
    expect(logout.status).toBe(200)
    expect(cookiesOf(logout).rencana_session!.value).toBe('')
    expect((await app.request('/api/me', { headers: header })).status).toBe(401)
  })

  it('requires a trusted Origin for cookie endpoints and unsafe cookie requests', async () => {
    await createUser('alice')
    const body = { username: 'alice', password: 'travel1234' }
    for (const headers of [{}, { Origin: 'http://evil.example' }] as Record<string, string>[]) {
      const res = await post('/api/auth/login', body, headers)
      expect(res.status).toBe(403)
      expect(await errorCode(res)).toBe('forbidden_origin')
    }
    const login = await post('/api/auth/login', body, { Origin: WEB })
    const cookie = `rencana_session=${cookiesOf(login).rencana_session!.value}`
    const patch = (origin: string) => app.request('/api/me', {
      method: 'PATCH', headers: { ...JSON_HEADERS, Cookie: cookie, Origin: origin }, body: JSON.stringify({ displayName: 'Al' })
    })
    expect((await patch('http://evil.example')).status).toBe(403)
    expect((await patch(WEB)).status).toBe(200)
  })
})

describe('mobile tokens', () => {
  it('rotates refresh tokens and revokes the session on reuse', async () => {
    await createUser('alice')
    const first = await mobileLogin()
    const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })
    expect((await app.request('/api/me', { headers: bearer(first.accessToken) })).status).toBe(200)

    const refreshed = await post('/api/mobile/auth/refresh', { refreshToken: first.refreshToken })
    expect(refreshed.status).toBe(200)
    const second = (await json(refreshed)).tokens
    expect(second.refreshToken).not.toBe(first.refreshToken)
    expect((await app.request('/api/me', { headers: bearer(second.accessToken) })).status).toBe(200)

    const stale = await app.request('/api/me', { headers: bearer(first.accessToken) })
    expect(stale.status).toBe(401)
    expect(await errorCode(stale)).toBe('invalid_token')
    expect(stale.headers.get('WWW-Authenticate')).toContain('Bearer')

    const reuse = await post('/api/mobile/auth/refresh', { refreshToken: first.refreshToken })
    expect(reuse.status).toBe(401)
    expect(await errorCode(reuse)).toBe('session_revoked')

    const after = await post('/api/mobile/auth/refresh', { refreshToken: second.refreshToken })
    expect(after.status).toBe(401)
    expect(await errorCode(after)).toBe('invalid_token')
  })

  it('never falls back to the cookie when a bearer header is present', async () => {
    await createUser('alice')
    const login = await post('/api/auth/login', { username: 'alice', password: 'travel1234' }, { Origin: WEB })
    const cookie = `rencana_session=${cookiesOf(login).rencana_session!.value}`
    const res = await app.request('/api/me', { headers: { Cookie: cookie, Authorization: 'Bearer nope' } })
    expect(res.status).toBe(401)
  })
})

describe('mobile Google PKCE exchange', () => {
  it('accepts each code once and only with the right verifier', async () => {
    const user = await createUser('alice')
    const verifier = 'v1'.repeat(22)
    const insertCode = async (code: string, ttlMs = 60_000) => db.insert(oauthCodes).values({
      codeHash: sha256Hex(code), userId: user.id, codeChallenge: sha256B64url(verifier), expiresAt: new Date(Date.now() + ttlMs)
    })
    const exchange = (code: string, codeVerifier: string) => post('/api/mobile/auth/google', { code, codeVerifier })

    await insertCode('code-one-aaaaaaaaaaaaaaaa')
    const wrong = await exchange('code-one-aaaaaaaaaaaaaaaa', 'x'.repeat(43))
    expect(wrong.status).toBe(400)
    expect(await errorCode(wrong)).toBe('invalid_grant')
    expect((await exchange('code-one-aaaaaaaaaaaaaaaa', verifier)).status).toBe(400)

    await insertCode('code-two-bbbbbbbbbbbbbbbb')
    const ok = await exchange('code-two-bbbbbbbbbbbbbbbb', verifier)
    expect(ok.status).toBe(200)
    expect((await json(ok)).tokens.accessToken).toBeTruthy()

    await insertCode('code-old-cccccccccccccccc', -1000)
    expect((await exchange('code-old-cccccccccccccccc', verifier)).status).toBe(400)
  })
})

describe('passwords', () => {
  it('upgrades legacy scrypt hashes to argon2id on login', async () => {
    const user = await createUser('legacy', undefined, await new Scrypt({}).make('travel1234'))
    expect((await post('/api/mobile/auth/login', { username: 'legacy', password: 'travel1234' })).status).toBe(200)
    const row = await db.query.users.findFirst({ where: eq(users.id, user.id) })
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/)

    const wrong = await post('/api/mobile/auth/login', { username: 'legacy', password: 'nope-nope' })
    expect(wrong.status).toBe(401)
    expect(await errorCode(wrong)).toBe('invalid_credentials')
  })

  it('rate limits repeated logins for one username', async () => {
    await createUser('alice')
    for (let i = 0; i < 10; i++) {
      expect((await post('/api/mobile/auth/login', { username: 'alice', password: 'wrong-password' })).status).toBe(401)
    }
    const blocked = await post('/api/mobile/auth/login', { username: 'alice', password: 'wrong-password' })
    expect(blocked.status).toBe(429)
    expect(await errorCode(blocked)).toBe('too_many_requests')
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0)
  })
})

describe('ownership and headers', () => {
  it('hides other users\' plans and files', async () => {
    const alice = await createUser('alice')
    await createUser('bob')
    const { plan, file } = await createPlanWithFile(alice.id)
    const { accessToken } = await mobileLogin('bob')
    const headers = { Authorization: `Bearer ${accessToken}` }

    const planRes = await app.request(`/api/plans/${plan.id}`, { headers })
    expect(planRes.status).toBe(404)
    expect(await errorCode(planRes)).toBe('plan_not_found')
    const fileRes = await app.request(`/api/files/${file.id}`, { headers })
    expect(fileRes.status).toBe(404)
    expect(await errorCode(fileRes)).toBe('file_not_found')
  })

  it('sets security headers on API responses', async () => {
    await createUser('alice')
    const { accessToken } = await mobileLogin()
    const res = await app.request('/api/plans', { headers: { Authorization: `Bearer ${accessToken}` } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Security-Policy')).toBe('default-src \'none\'; frame-ancestors \'none\'')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-site')
  })
})
