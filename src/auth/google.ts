import { createRemoteJWKSet, jwtVerify } from 'jose'
import { env } from '../env.ts'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

export interface GoogleProfile {
  sub: string
  email: string | null
  name: string | null
  picture: string | null
}

export function googleAuthorizeUrl(params: { state: string, nonce: string, codeChallenge: string }): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: env.GOOGLE_REDIRECT_URL,
    scope: 'openid email profile',
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  })
  return `${AUTHORIZE_URL}?${query}`
}

/** Exchanges the authorization code and verifies the ID token (issuer, audience, nonce, signature). */
export async function exchangeGoogleCode(code: string, verifier: string, nonce: string): Promise<GoogleProfile> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.GOOGLE_REDIRECT_URL,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      code_verifier: verifier
    }),
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new Error(`Google token endpoint returned ${response.status}`)
  const tokens = await response.json() as { id_token?: unknown }
  if (typeof tokens.id_token !== 'string') throw new Error('Google response without id_token')
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: env.GOOGLE_CLIENT_ID!
  })
  if (payload.nonce !== nonce || typeof payload.sub !== 'string') throw new Error('Google ID token nonce mismatch')
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return {
    sub: payload.sub,
    email: payload.email_verified === true ? str(payload.email) : null,
    name: str(payload.name),
    picture: str(payload.picture)
  }
}
