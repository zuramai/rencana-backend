import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'

/** API error with the h3-compatible wire format `{ statusCode, statusMessage, data? }`. */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string
  readonly data?: unknown
  readonly headers?: Record<string, string>

  constructor(status: ContentfulStatusCode, code: string, data?: unknown, headers?: Record<string, string>) {
    super(code)
    this.status = status
    this.code = code
    this.data = data
    this.headers = headers
  }
}

export function httpError(status: ContentfulStatusCode, code: string, data?: unknown, headers?: Record<string, string>): HttpError {
  return new HttpError(status, code, data, headers)
}

function errorBody(statusCode: number, statusMessage: string, data?: unknown) {
  return data === undefined ? { statusCode, statusMessage } : { statusCode, statusMessage, data }
}

export function onError(err: Error, c: Context): Response {
  if (err instanceof HttpError) {
    if (err.headers) for (const [k, v] of Object.entries(err.headers)) c.header(k, v)
    return c.json(errorBody(err.status, err.code, err.data), err.status)
  }
  if (err instanceof ZodError) {
    return c.json(errorBody(400, 'validation_error', err.issues), 400)
  }
  if (err instanceof HTTPException) {
    const status = err.status as ContentfulStatusCode
    return c.json(errorBody(status, status === 413 ? 'file_too_large' : `http_${status}`), status)
  }
  console.error(c.get('requestId'), err)
  return c.json(errorBody(500, 'internal_error'), 500)
}

export function notFound(c: Context): Response {
  return c.json(errorBody(404, 'not_found'), 404)
}
