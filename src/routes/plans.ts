import { Hono } from 'hono'
import { and, desc, eq, sql } from 'drizzle-orm'
import { rateInput } from '#shared/schemas/cost'
import { currencyCode } from '#shared/schemas/common'
import { planInput } from '#shared/schemas/plan'
import type { SummaryDto } from '#shared/types/dto'
import { db } from '../db/client.ts'
import { itineraryItems, planFxRates, plans, ticketFiles, tickets } from '../db/schema.ts'
import { httpError } from '../http/errors.ts'
import { readMultipart } from '../http/multipart.ts'
import { parseJson } from '../http/validate.ts'
import { loadPlanBudget } from '../lib/fx.ts'
import { requirePlan } from '../lib/plans.ts'
import { deleteFileRows, saveUpload } from '../lib/uploads.ts'
import type { AppEnv } from '../types.ts'

export const plansRoutes = new Hono<AppEnv>()

plansRoutes.get('/', async (c) => {
  const rows = await db.select({
    id: plans.id,
    name: plans.name,
    coverType: plans.coverType,
    coverEmoji: plans.coverEmoji,
    coverFileId: plans.coverFileId,
    coverColor: plans.coverColor,
    startYear: plans.startYear,
    startMonth: plans.startMonth,
    endYear: plans.endYear,
    endMonth: plans.endMonth
  }).from(plans).where(eq(plans.userId, c.get('user').id)).orderBy(desc(plans.updatedAt))
  return c.json(rows)
})

plansRoutes.post('/', async (c) => {
  const user = c.get('user')
  const { data, files } = await readMultipart(c, planInput)
  const image = files('image')[0]
  if (data.coverType === 'image' && !image) throw httpError(400, 'cover_required')
  const cover = data.coverType === 'image' && image ? await saveUpload(user.id, image, { allowPdf: false }) : null

  const [row] = await db.insert(plans).values({
    userId: user.id,
    name: data.name,
    coverType: data.coverType,
    coverEmoji: data.coverEmoji,
    coverFileId: cover?.id ?? null,
    coverColor: data.coverColor,
    startYear: data.startYear,
    startMonth: data.startMonth,
    endYear: data.endYear,
    endMonth: data.endMonth,
    budgetCurrency: data.budgetCurrency,
    budgetAmount: data.budgetAmount,
    timeZone: data.timeZone
  }).returning({ id: plans.id })
  return c.json({ id: row!.id })
})

plansRoutes.get('/:id', async (c) => {
  const { userId: _userId, ...plan } = await requirePlan(c.get('user').id, c.req.param('id'))
  return c.json(plan)
})

plansRoutes.patch('/:id', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const { data, files } = await readMultipart(c, planInput)
  const image = files('image')[0]

  let coverFileId = plan.coverFileId
  if (data.coverType === 'image' && image) {
    coverFileId = (await saveUpload(plan.userId, image, { allowPdf: false })).id
  } else if (data.coverType === 'emoji' || data.removeCoverImage) {
    coverFileId = null
  }
  if (data.coverType === 'image' && !coverFileId) throw httpError(400, 'cover_required')

  await db.transaction(async (tx) => {
    await tx.update(plans).set({
      name: data.name,
      coverType: data.coverType,
      coverEmoji: data.coverEmoji,
      coverFileId,
      coverColor: data.coverColor,
      startYear: data.startYear,
      startMonth: data.startMonth,
      endYear: data.endYear,
      endMonth: data.endMonth,
      budgetCurrency: data.budgetCurrency,
      budgetAmount: data.budgetAmount,
      timeZone: data.timeZone,
      updatedAt: sql`now()`
    }).where(eq(plans.id, plan.id))
    // Rates are stored relative to the budget currency.
    if (data.budgetCurrency !== plan.budgetCurrency) await tx.delete(planFxRates).where(eq(planFxRates.planId, plan.id))
  })
  if (plan.coverFileId && plan.coverFileId !== coverFileId) await deleteFileRows([plan.coverFileId])
  return c.json({ id: plan.id })
})

plansRoutes.delete('/:id', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const fileIds = await db.transaction(async (tx) => {
    const itemImages = await tx.select({ id: itineraryItems.imageFileId }).from(itineraryItems).where(eq(itineraryItems.planId, plan.id))
    const ticketFileIds = await tx.select({ id: ticketFiles.fileId }).from(ticketFiles)
      .innerJoin(tickets, eq(tickets.id, ticketFiles.ticketId)).where(eq(tickets.planId, plan.id))
    await tx.delete(plans).where(eq(plans.id, plan.id))
    return [plan.coverFileId, ...itemImages.map(r => r.id), ...ticketFileIds.map(r => r.id)]
  })
  await deleteFileRows(fileIds)
  return c.json({ ok: true })
})

plansRoutes.get('/:id/summary', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const { summary, rates } = await loadPlanBudget(plan)
  const body: SummaryDto = { ...summary, rates }
  return c.json(body)
})

plansRoutes.put('/:id/rates/:currency', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const currency = currencyCode.safeParse(c.req.param('currency'))
  if (!currency.success || currency.data === plan.budgetCurrency) throw httpError(400, 'invalid_currency')
  const { rate } = await parseJson(c, rateInput)
  if (rate == null) {
    await db.delete(planFxRates).where(and(eq(planFxRates.planId, plan.id), eq(planFxRates.currency, currency.data)))
  } else {
    const values = { planId: plan.id, currency: currency.data, rate: String(rate), source: 'manual', fetchedAt: new Date() }
    await db.insert(planFxRates).values(values).onConflictDoUpdate({
      target: [planFxRates.planId, planFxRates.currency],
      set: { rate: values.rate, source: 'manual', fetchedAt: values.fetchedAt }
    })
  }
  return c.json({ ok: true })
})
