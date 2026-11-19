import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { db } from '../db/client.ts'
import { files, type FileRow } from '../db/schema.ts'
import { httpError } from '../http/errors.ts'
import type { UploadPart } from '../http/multipart.ts'
import { deleteObjects, putObject } from './storage.ts'

const IMAGE_FORMATS: Record<string, true> = { jpeg: true, png: true, webp: true, avif: true, gif: true }
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_PDF_BYTES = 15 * 1024 * 1024

/** Sniff, normalise (images → JPEG + thumbnail) and store one upload. */
export async function saveUpload(userId: string, part: UploadPart, { allowPdf }: { allowPdf: boolean }): Promise<FileRow> {
  const fileId = randomUUID()
  const originalName = (part.name || 'file').slice(0, 200)
  const buf = part.data

  if (allowPdf && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    if (buf.length > MAX_PDF_BYTES) throw httpError(413, 'file_too_large')
    const key = `u/${userId}/${fileId}.pdf`
    await putObject(key, buf, 'application/pdf')
    const [row] = await db.insert(files).values({
      id: fileId, userId, s3Key: key, contentType: 'application/pdf', byteSize: buf.length, originalName
    }).returning()
    return row!
  }

  let format: string | undefined
  try {
    format = (await sharp(buf).metadata()).format
  } catch {
    format = undefined
  }
  if (!format || !IMAGE_FORMATS[format]) throw httpError(415, 'unsupported_file')
  if (buf.length > MAX_IMAGE_BYTES) throw httpError(413, 'file_too_large')

  const image = await sharp(buf).rotate()
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 }).toBuffer()
  const thumb = await sharp(buf).rotate()
    .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 }).toBuffer()
  const key = `u/${userId}/${fileId}.jpg`
  const thumbKey = `u/${userId}/${fileId}_t.jpg`
  await Promise.all([putObject(key, image, 'image/jpeg'), putObject(thumbKey, thumb, 'image/jpeg')])
  const [row] = await db.insert(files).values({
    id: fileId, userId, s3Key: key, thumbS3Key: thumbKey, contentType: 'image/jpeg', byteSize: image.length, originalName
  }).returning()
  return row!
}

/** Store several uploads; if one fails, the ones already stored are removed. */
export async function saveUploads(userId: string, parts: UploadPart[], options: { allowPdf: boolean }): Promise<FileRow[]> {
  const saved: FileRow[] = []
  try {
    for (const part of parts) saved.push(await saveUpload(userId, part, options))
  } catch (error) {
    await deleteFileRows(saved.map(f => f.id))
    throw error
  }
  return saved
}

/** Delete file rows, then their S3 objects. */
export async function deleteFileRows(ids: (string | null | undefined)[]): Promise<void> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  if (unique.length === 0) return
  const rows = await db.delete(files).where(inArray(files.id, unique)).returning({ s3Key: files.s3Key, thumbS3Key: files.thumbS3Key })
  await deleteObjects(rows.flatMap(r => (r.thumbS3Key ? [r.s3Key, r.thumbS3Key] : [r.s3Key])))
}
