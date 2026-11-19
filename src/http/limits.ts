import { createRateLimiter, type RateLimiter } from './rate-limit.ts'

const MIN = 60_000

export interface Limiters {
  api: RateLimiter
  loginIp: RateLimiter
  loginUser: RateLimiter
  register: RateLimiter
  token: RateLimiter
}

/** Fresh limiter set; one per app instance. */
export function createLimiters(): Limiters {
  return {
    api: createRateLimiter({ windowMs: MIN, limit: 600 }),
    loginIp: createRateLimiter({ windowMs: 15 * MIN, limit: 20 }),
    loginUser: createRateLimiter({ windowMs: 15 * MIN, limit: 10 }),
    register: createRateLimiter({ windowMs: 60 * MIN, limit: 10 }),
    token: createRateLimiter({ windowMs: 15 * MIN, limit: 60 })
  }
}
