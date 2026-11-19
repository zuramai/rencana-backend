import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { env } from '../env.ts'
import { httpError } from './errors.ts'

export interface RateLimiter {
  hit(key: string): { ok: boolean, retryAfterSec: number }
}

const PRUNE_THRESHOLD = 10_000

/** Fixed-window in-memory counter per key. */
export function createRateLimiter({ windowMs, limit }: { windowMs: number, limit: number }): RateLimiter {
  const windows = new Map<string, { start: number, count: number }>()
  return {
    hit(key) {
      const now = Date.now()
      if (windows.size > PRUNE_THRESHOLD) {
        for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k)
      }
      let w = windows.get(key)
      if (!w || now - w.start >= windowMs) {
        w = { start: now, count: 0 }
        windows.set(key, w)
      }
      w.count++
      const retryAfterSec = Math.max(1, Math.ceil((w.start + windowMs - now) / 1000))
      return { ok: w.count <= limit, retryAfterSec }
    }
  }
}

/** Throws 429 `too_many_requests` with `Retry-After` when `key` is over the limit. */
export function enforce(limiter: RateLimiter, key: string): void {
  const { ok, retryAfterSec } = limiter.hit(key)
  if (!ok) throw httpError(429, 'too_many_requests', undefined, { 'Retry-After': String(retryAfterSec) })
}

export function clientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
