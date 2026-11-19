import type { Context } from 'hono'
import type { z } from 'zod'
import { isUuid } from '../lib/plans.ts'
import { httpError } from './errors.ts'

/** JSON body validated by `schema`; malformed JSON → 400 `invalid_body`, schema errors → 400 `validation_error`. */
export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw httpError(400, 'invalid_body')
  }
  return schema.parse(body)
}

/** Route param that must be a UUID; anything else is a 404 with `code`. */
export function uuidParam(c: Context, name: string, code: string): string {
  const value = c.req.param(name)
  if (!value || !isUuid(value)) throw httpError(404, code)
  return value
}
