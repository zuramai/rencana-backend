import type { Context } from 'hono'
import type { z } from 'zod'
import { httpError } from './errors.ts'

export interface UploadPart {
  name: string
  data: Buffer
}

const MAX_FILES = 10

/**
 * Multipart request: field `data` is a JSON string validated by `schema`; every
 * other non-empty file entry is an upload, grouped by field name.
 */
export async function readMultipart<S extends z.ZodType>(c: Context, schema: S) {
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    throw httpError(400, 'invalid_body')
  }
  const raw = form.get('data')
  if (typeof raw !== 'string') throw httpError(400, 'invalid_body')
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw httpError(400, 'invalid_body')
  }
  const data = schema.parse(json)

  const byField = new Map<string, UploadPart[]>()
  let count = 0
  for (const [field, value] of form.entries()) {
    if (typeof value === 'string' || value.size === 0) continue
    if (++count > MAX_FILES) throw httpError(400, 'too_many_files')
    const part = { name: value.name || 'file', data: Buffer.from(await value.arrayBuffer()) }
    byField.set(field, [...(byField.get(field) ?? []), part])
  }
  return { data, files: (field: string) => byField.get(field) ?? [] }
}
