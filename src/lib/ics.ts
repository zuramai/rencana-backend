import type { ItemDto } from '#shared/types/dto'
import { calendarSpan, compactDateTime } from '#shared/utils/calendar'
import type { ExportContext } from './export-context.ts'

const pad = (n: number) => String(n).padStart(2, '0')

/** Offset (ms) of [timeZone] from UTC at the instant [utcMs]. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(utcMs)
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs
}

/**
 * Instant of a `YYYY-MM-DDTHH:mm` wall clock in [timeZone]. A repeated time (DST fall-back) resolves
 * to its first occurrence; a skipped time (spring-forward gap) resolves forward, like Temporal's
 * `disambiguation: 'compatible'`.
 */
export function wallClockToUtc(wallClock: string, timeZone: string): Date {
  const [y, m, d] = wallClock.slice(0, 10).split('-').map(Number)
  const [h, mi] = wallClock.slice(11, 16).split(':').map(Number)
  const naive = Date.UTC(y!, m! - 1, d!, h!, mi!)
  const DAY = 86_400_000
  const before = naive - zoneOffsetMs(naive - DAY, timeZone)
  const after = naive - zoneOffsetMs(naive + DAY, timeZone)
  const valid = [before, after].filter(c => c + zoneOffsetMs(c, timeZone) === naive)
  return new Date(valid.length > 0 ? Math.min(...valid) : before)
}

function utcStamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

/** RFC 5545 TEXT escaping. */
function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Folds a content line at 75 octets without splitting UTF-8 sequences. */
function fold(line: string): string {
  const out: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const bytes = Buffer.byteLength(char)
    const limit = out.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      out.push(current)
      current = ''
      size = 0
    }
    current += char
    size += bytes
  }
  out.push(current)
  return out.join('\r\n ')
}

function dateTimeProps(start: string, end: string, allDay: boolean, timeZone: string | null): string[] {
  if (allDay) return [`DTSTART;VALUE=DATE:${compactDateTime(start)}`, `DTEND;VALUE=DATE:${compactDateTime(end)}`]
  if (timeZone) return [`DTSTART:${utcStamp(wallClockToUtc(start, timeZone))}`, `DTEND:${utcStamp(wallClockToUtc(end, timeZone))}`]
  // No destination zone: floating times, shown at the same clock time in any calendar zone.
  return [`DTSTART:${compactDateTime(start)}`, `DTEND:${compactDateTime(end)}`]
}

/** iCalendar file with one event per itinerary item. */
export function buildItineraryIcs(ctx: ExportContext, items: ItemDto[], now = new Date()): string {
  const { plan, t, money } = ctx
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rencana//Itinerary//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(plan.name)}`,
    ...(plan.timeZone ? [`X-WR-TIMEZONE:${plan.timeZone}`] : [])
  ]
  for (const item of items) {
    const span = calendarSpan(item)
    const summaryLine = [t(`itemTypes.${item.type}`), item.price != null && item.currency ? money(Number(item.price), item.currency) : null]
      .filter(Boolean).join(' · ')
    const description = [summaryLine, item.note, item.link].filter(Boolean).join('\n\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.id}@rencana`,
      `DTSTAMP:${utcStamp(now)}`,
      ...dateTimeProps(span.start, span.end, span.allDay, plan.timeZone),
      `SUMMARY:${escapeText(item.description)}`,
      `DESCRIPTION:${escapeText(description)}`,
      ...(item.link ? [`URL:${item.link}`] : []),
      'END:VEVENT'
    )
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}
