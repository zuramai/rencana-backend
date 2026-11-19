import type { Context } from 'hono'
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie'
import { env, isProduction } from '../env.ts'

const SESSION = 'rencana_session'
const OAUTH = 'rencana_oauth'
/** Production cookies use the `__Host-` prefix, which forces Secure, Path=/ and no Domain. */
const prefix = isProduction ? { prefix: 'host' as const } : { secure: false }
const nameOf = (name: string) => (isProduction ? `__Host-${name}` : name)

export function getSessionCookie(c: Context): string | undefined {
  return isProduction ? getCookie(c, SESSION, 'host') : getCookie(c, SESSION)
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION, token, { ...prefix, httpOnly: true, sameSite: 'Strict', path: '/', maxAge: 30 * 86400 })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, nameOf(SESSION), { ...(isProduction ? { secure: true } : {}), path: '/' })
}

export interface OAuthState {
  /** state sent to Google */
  s: string
  /** OIDC nonce */
  n: string
  /** PKCE verifier for Google */
  v: string
  /** client */
  c: 'web' | 'mobile'
  /** mobile app state */
  as?: string
  /** mobile app PKCE challenge */
  ac?: string
  /** locale */
  l: 'en' | 'id'
  /** time zone */
  tz?: string
}

export async function setOAuthCookie(c: Context, value: OAuthState): Promise<void> {
  await setSignedCookie(c, OAUTH, JSON.stringify(value), env.COOKIE_SECRET, {
    ...prefix, httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 600
  })
}

/** Reads and clears the OAuth cookie; null when missing or the signature is invalid. */
export async function takeOAuthCookie(c: Context): Promise<OAuthState | null> {
  const raw = isProduction
    ? await getSignedCookie(c, env.COOKIE_SECRET, OAUTH, 'host')
    : await getSignedCookie(c, env.COOKIE_SECRET, OAUTH)
  deleteCookie(c, nameOf(OAUTH), { ...(isProduction ? { secure: true } : {}), path: '/' })
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as OAuthState
    return typeof value?.s === 'string' && typeof value.n === 'string' && typeof value.v === 'string' ? value : null
  } catch {
    return null
  }
}
