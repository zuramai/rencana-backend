import { Hono } from 'hono'
import { and, asc, eq, sql } from 'drizzle-orm'
import { itemInput } from '#shared/schemas/item'
import { db } from '../db/client.ts'
import { itineraryItems } from '../db/schema.ts'
import { readMultipart } from '../http/multipart.ts'
import { itemDto } from '../lib/dto.ts'
import { findItem, requirePlan, touchPlan } from '../lib/plans.ts'
import { deleteFileRows, saveUpload } from '../lib/uploads.ts'
import type { AppEnv } from '../types.ts'

export const itemsRoutes = new Hono<AppEnv>()

itemsRoutes.get('/:id/items', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const rows = await db.select().from(itineraryItems).where(eq(itineraryItems.planId, plan.id))
    .orderBy(asc(itineraryItems.startsAt), asc(itineraryItems.createdAt))
  return c.json(rows.map(itemDto))
})

itemsRoutes.post('/:id/items', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const { data, files } = await readMultipart(c, itemInput)
  const image = files('image')[0]
  const file = image ? await saveUpload(plan.userId, image, { allowPdf: false }) : null
  const [row] = await db.insert(itineraryItems).values({
    planId: plan.id,
    type: data.type,
    description: data.description,
    allDay: data.allDay,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    currency: data.currency,
    price: data.price,
    note: data.note,
    link: data.link,
    imageFileId: file?.id ?? null
  }).returning()
  await touchPlan(plan.id)
  return c.json(itemDto(row!))
})

itemsRoutes.patch('/:id/items/:itemId', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const item = await findItem(plan.id, c.req.param('itemId'))
  const { data, files } = await readMultipart(c, itemInput)
  const image = files('image')[0]

  let imageFileId = item.imageFileId
  if (image) imageFileId = (await saveUpload(plan.userId, image, { allowPdf: false })).id
  else if (data.removeImage) imageFileId = null

  const [row] = await db.update(itineraryItems).set({
    type: data.type,
    description: data.description,
    allDay: data.allDay,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    currency: data.currency,
    price: data.price,
    note: data.note,
    link: data.link,
    imageFileId,
    updatedAt: sql`now()`
  }).where(and(eq(itineraryItems.id, item.id), eq(itineraryItems.planId, plan.id))).returning()
  if (item.imageFileId && item.imageFileId !== imageFileId) await deleteFileRows([item.imageFileId])
  await touchPlan(plan.id)
  return c.json(itemDto(row!))
})

itemsRoutes.delete('/:id/items/:itemId', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const item = await findItem(plan.id, c.req.param('itemId'))
  await db.delete(itineraryItems).where(eq(itineraryItems.id, item.id))
  await deleteFileRows([item.imageFileId])
  await touchPlan(plan.id)
  return c.json({ ok: true })
})
