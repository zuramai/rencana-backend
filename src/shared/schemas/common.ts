import { z } from 'zod'

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'invalid_currency')

export const decimalString = z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/, 'invalid_amount')

export const wallClock = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'invalid_datetime')

export const httpUrl = z.string().trim().max(2000).regex(/^https?:\/\/\S+$/i, 'invalid_url')

/** Optional free text: trimmed, empty becomes null. */
export const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform(v => (v ? v : null))

export const optionalUrl = httpUrl.or(z.literal('')).nullish().transform(v => (v ? v : null))

export const localeCode = z.enum(['en', 'id'])

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/**
 * IANA time zone name ("Asia/Tokyo", "UTC"). Empty string or null clear it; omitted stays undefined,
 * so updates from clients that don't know the field leave the stored value alone.
 */
export const timeZoneName = z.string().trim().max(64)
  .refine(v => v === '' || (/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(v) && isTimeZone(v)), 'invalid_time_zone')
  .transform(v => (v ? v : null))
  .nullable().optional()
