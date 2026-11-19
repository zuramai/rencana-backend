import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { files } from '../db/schema.ts'
import { httpError } from '../http/errors.ts'
import { uuidParam } from '../http/validate.ts'
import { getObjectStream } from '../lib/storage.ts'
import type { AppEnv } from '../types.ts'

export const filesRoutes = new Hono<AppEnv>()

/** `inline; filename="<ascii fallback>"; filename*=UTF-8''<encoded>` */
function inlineDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'file'
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

filesRoutes.get('/:id', async (c) => {
  const id = uuidParam(c, 'id', 'file_not_found')
  const row = await db.query.files.findFirst({ where: and(eq(files.id, id), eq(files.userId, c.get('user').id)) })
  if (!row) throw httpError(404, 'file_not_found')
  const thumb = c.req.query('size') === 'thumb' && row.thumbS3Key
  const { body, contentLength } = await getObjectStream(thumb ? row.thumbS3Key! : row.s3Key)
  const headers: Record<string, string> = {
    'Content-Type': thumb ? 'image/jpeg' : row.contentType,
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': inlineDisposition(row.originalName)
  }
  if (contentLength != null) headers['Content-Length'] = String(contentLength)
  return c.body(body, 200, headers)
})
