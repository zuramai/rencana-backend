import { readFile } from 'node:fs/promises'
import { getIconData, iconToHTML, iconToSVG } from '@iconify/utils'
import { icons as fluentEmoji } from '@iconify-json/fluent-emoji-flat'
import { eq } from 'drizzle-orm'
import { formatMoney } from '#shared/utils/money'
import { formatPeriod } from '#shared/utils/period'
import { db } from '../db/client.ts'
import { files, type PlanRow } from '../db/schema.ts'
import type { SessionUser } from '../types.ts'
import { serverT } from './i18n.ts'
import { getObjectBytes } from './storage.ts'

export interface ExportContext {
  plan: PlanRow
  locale: 'en' | 'id'
  t: (key: string, params?: Record<string, string | number>) => string
  money: (amount: number, currency: string) => string
  period: string | null
}

export function exportContext(user: SessionUser, plan: PlanRow): ExportContext {
  const locale = user.locale
  return {
    plan,
    locale,
    t: (key, params) => serverT(locale, key, params),
    money: (amount, currency) => formatMoney(amount, currency, locale),
    period: formatPeriod(plan, locale)
  }
}

/** `fluent-emoji-flat:airplane` → standalone SVG markup, or null for unknown names. */
export function emojiSvg(name: string | null, size = 64): string | null {
  const icon = name ? getIconData(fluentEmoji, name.replace(/^fluent-emoji-flat:/, '')) : null
  if (!icon) return null
  const { attributes, body } = iconToSVG(icon, { width: size, height: size })
  return iconToHTML(body, attributes)
}

/** JPEG data URL of a stored file (thumbnail when available), or null if it can't be read. */
export async function fileDataUrl(fileId: string | null, preferThumb = true): Promise<string | null> {
  if (!fileId) return null
  const row = await db.query.files.findFirst({ where: eq(files.id, fileId) })
  if (!row || row.contentType !== 'image/jpeg') return null
  try {
    const bytes = await getObjectBytes(preferThumb && row.thumbS3Key ? row.thumbS3Key : row.s3Key)
    return `data:image/jpeg;base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`
  } catch {
    return null
  }
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'trip'
}

export interface FontFiles {
  regular: Uint8Array
  medium: Uint8Array
  italic: Uint8Array
  mediumItalic: Uint8Array
}

/** Roboto TTFs from `assets/fonts`, cached for the process. */
let fonts: FontFiles | undefined
export async function loadFonts(): Promise<FontFiles> {
  if (fonts) return fonts
  const read = async (name: string) => new Uint8Array(await readFile(new URL(`../../assets/fonts/${name}`, import.meta.url)))
  fonts = {
    regular: await read('Roboto-Regular.ttf'),
    medium: await read('Roboto-Medium.ttf'),
    italic: await read('Roboto-Italic.ttf'),
    mediumItalic: await read('Roboto-MediumItalic.ttf')
  }
  return fonts
}
