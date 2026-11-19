import { describe, expect, it } from 'vitest'
import { googleCalendarUrl, type CalendarItem } from '#shared/utils/calendar'
import { buildItineraryIcs, wallClockToUtc } from '../../src/lib/ics.ts'
import type { ExportContext } from '../../src/lib/export-context.ts'
import type { PlanRow } from '../../src/db/schema.ts'
import type { ItemDto } from '#shared/types/dto'

const base: CalendarItem = { description: 'Ramen dinner', allDay: false, startsAt: '2027-03-03T19:00', endsAt: null, note: null, link: null }
const query = (url: string) => new URL(url).searchParams

describe('googleCalendarUrl', () => {
  it('defaults timed events to one hour in the destination zone', () => {
    const q = query(googleCalendarUrl(base, 'Asia/Tokyo'))
    expect(q.get('action')).toBe('TEMPLATE')
    expect(q.get('text')).toBe('Ramen dinner')
    expect(q.get('dates')).toBe('20270303T190000/20270303T200000')
    expect(q.get('ctz')).toBe('Asia/Tokyo')
    expect(q.has('details')).toBe(false)
  })

  it('rolls a default end over midnight', () => {
    expect(query(googleCalendarUrl({ ...base, startsAt: '2027-12-31T23:30' }, null)).get('dates'))
      .toBe('20271231T233000/20280101T003000')
  })

  it('uses dates with an exclusive end for all-day items and omits ctz', () => {
    const q = query(googleCalendarUrl({ ...base, allDay: true, startsAt: '2027-03-03T00:00', endsAt: '2027-03-05T00:00' }, 'Asia/Tokyo'))
    expect(q.get('dates')).toBe('20270303/20270306')
    expect(q.has('ctz')).toBe(false)
  })

  it('puts the note and link in the details', () => {
    const q = query(googleCalendarUrl({ ...base, endsAt: '2027-03-03T21:15', note: 'Book ahead', link: 'https://ichiran.com' }, null))
    expect(q.get('dates')).toBe('20270303T190000/20270303T211500')
    expect(q.get('details')).toBe('Book ahead\n\nhttps://ichiran.com')
    expect(q.has('ctz')).toBe(false)
  })
})

describe('wallClockToUtc', () => {
  it('converts with the zone offset', () => {
    expect(wallClockToUtc('2027-03-03T19:00', 'Asia/Tokyo').toISOString()).toBe('2027-03-03T10:00:00.000Z')
    expect(wallClockToUtc('2027-07-01T09:00', 'Europe/Berlin').toISOString()).toBe('2027-07-01T07:00:00.000Z')
  })

  it('moves times inside a spring-forward gap forward', () => {
    expect(wallClockToUtc('2027-03-14T02:30', 'America/New_York').toISOString()).toBe('2027-03-14T07:30:00.000Z')
  })

  it('takes the first occurrence of a repeated fall-back time', () => {
    expect(wallClockToUtc('2027-10-31T02:30', 'Europe/Berlin').toISOString()).toBe('2027-10-31T00:30:00.000Z')
    expect(wallClockToUtc('2027-11-07T01:30', 'America/New_York').toISOString()).toBe('2027-11-07T05:30:00.000Z')
  })
})

describe('buildItineraryIcs', () => {
  const ctx = (timeZone: string | null) => ({
    plan: { name: 'Tokyo, Spring; 2027', timeZone } as PlanRow,
    locale: 'en',
    t: (key: string) => (key === 'itemTypes.food_beverage' ? 'Food & drink' : key),
    money: (amount: number, currency: string) => `${currency} ${amount}`,
    period: null
  }) satisfies ExportContext
  const item = (over: Partial<ItemDto>): ItemDto => ({
    id: '11111111-1111-1111-1111-111111111111', type: 'food_beverage', description: 'Ramen dinner', allDay: false,
    startsAt: '2027-03-03T19:00', endsAt: null, currency: 'JPY', price: '1500.00', note: null, link: null, imageFileId: null, ...over
  })
  const now = new Date('2026-11-19T12:00:00Z')

  it('writes UTC times for a plan with a destination zone', () => {
    const ics = buildItineraryIcs(ctx('Asia/Tokyo'), [item({})], now)
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics).toContain('X-WR-CALNAME:Tokyo\\, Spring\\; 2027\r\n')
    expect(ics).toContain('X-WR-TIMEZONE:Asia/Tokyo\r\n')
    expect(ics).toContain('UID:11111111-1111-1111-1111-111111111111@rencana\r\n')
    expect(ics).toContain('DTSTAMP:20261119T120000Z\r\n')
    expect(ics).toContain('DTSTART:20270303T100000Z\r\nDTEND:20270303T110000Z\r\n')
    expect(ics).toContain('DESCRIPTION:Food & drink · JPY 1500\r\n')
  })

  it('writes floating times without a zone and dates for all-day items', () => {
    const ics = buildItineraryIcs(ctx(null), [
      item({}),
      item({ id: '22222222-2222-2222-2222-222222222222', allDay: true, startsAt: '2027-03-04T00:00', price: null, currency: null, note: 'Line 1\nLine 2', link: 'https://x.example/a,b' })
    ], now)
    expect(ics).not.toContain('X-WR-TIMEZONE')
    expect(ics).toContain('DTSTART:20270303T190000\r\nDTEND:20270303T200000\r\n')
    expect(ics).toContain('DTSTART;VALUE=DATE:20270304\r\nDTEND;VALUE=DATE:20270305\r\n')
    expect(ics).toContain('DESCRIPTION:Food & drink\\n\\nLine 1\\nLine 2\\n\\nhttps://x.example/a\\,b\r\n')
    expect(ics).toContain('URL:https://x.example/a,b\r\n')
  })

  it('folds long lines at 75 octets', () => {
    const ics = buildItineraryIcs(ctx(null), [item({ description: 'ラーメン'.repeat(20) })], now)
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
    expect(ics.split('\r\n').find(l => l.startsWith('SUMMARY:'))).toBeTruthy()
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${'ラーメン'.repeat(20)}\r\n`)
  })
})
