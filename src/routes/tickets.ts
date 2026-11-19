import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'
import { ticketInput } from '#shared/schemas/ticket'
import { db } from '../db/client.ts'
import { ticketFiles, tickets } from '../db/schema.ts'
import { httpError } from '../http/errors.ts'
import { readMultipart } from '../http/multipart.ts'
import { requirePlan, touchPlan } from '../lib/plans.ts'
import { findTicket, loadTickets } from '../lib/tickets.ts'
import { deleteFileRows, saveUploads } from '../lib/uploads.ts'
import type { AppEnv } from '../types.ts'

export const ticketsRoutes = new Hono<AppEnv>()

ticketsRoutes.get('/:id/tickets', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  return c.json(await loadTickets(plan.id))
})

ticketsRoutes.post('/:id/tickets', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const { data, files } = await readMultipart(c, ticketInput)
  const parts = files('files')
  if (parts.length === 0) throw httpError(400, 'files_required')

  const saved = await saveUploads(plan.userId, parts, { allowPdf: true })
  const ticketId = await db.transaction(async (tx) => {
    const [row] = await tx.insert(tickets).values({
      planId: plan.id,
      kind: data.kind,
      title: data.title,
      description: data.description,
      locationText: data.locationText,
      locationUrl: data.locationUrl
    }).returning({ id: tickets.id })
    await tx.insert(ticketFiles).values(saved.map((f, position) => ({ ticketId: row!.id, fileId: f.id, position })))
    return row!.id
  })
  await touchPlan(plan.id)
  return c.json(await findTicket(plan.id, ticketId))
})

ticketsRoutes.patch('/:id/tickets/:ticketId', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const ticket = await findTicket(plan.id, c.req.param('ticketId'))
  const { data, files } = await readMultipart(c, ticketInput)
  const parts = files('files')

  const removeIds = ticket.files.map(f => f.id).filter(id => data.removeFileIds?.includes(id))
  if (ticket.files.length - removeIds.length + parts.length === 0) throw httpError(400, 'files_required')

  const saved = await saveUploads(plan.userId, parts, { allowPdf: true })
  await db.transaction(async (tx) => {
    await tx.update(tickets).set({
      kind: data.kind,
      title: data.title,
      description: data.description,
      locationText: data.locationText,
      locationUrl: data.locationUrl,
      updatedAt: sql`now()`
    }).where(eq(tickets.id, ticket.id))
    if (saved.length > 0) {
      const [last] = await tx.select({ max: sql<number>`coalesce(max(${ticketFiles.position}), -1)::int` })
        .from(ticketFiles).where(eq(ticketFiles.ticketId, ticket.id))
      const start = (last?.max ?? -1) + 1
      await tx.insert(ticketFiles).values(saved.map((f, i) => ({ ticketId: ticket.id, fileId: f.id, position: start + i })))
    }
  })
  // Deleting the file rows cascades their ticket_files links.
  await deleteFileRows(removeIds)
  await touchPlan(plan.id)
  return c.json(await findTicket(plan.id, ticket.id))
})

ticketsRoutes.delete('/:id/tickets/:ticketId', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const ticket = await findTicket(plan.id, c.req.param('ticketId'))
  await db.delete(tickets).where(eq(tickets.id, ticket.id))
  await deleteFileRows(ticket.files.map(f => f.id))
  await touchPlan(plan.id)
  return c.json({ ok: true })
})
