import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 256-bit random token, base64url. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function sha256B64url(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

/** Constant-time string comparison; false for different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
