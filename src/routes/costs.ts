import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { costInput } from '#shared/schemas/cost'
import type { CostDto } from '#shared/types/dto'
import { db } from '../db/client.ts'
import { expectedCosts } from '../db/schema.ts'
import { httpError } from '../http/errors.ts'
import { parseJson } from '../http/validate.ts'
import { isUuid, requirePlan, touchPlan } from '../lib/plans.ts'
import type { AppEnv } from '../types.ts'

export const costsRoutes = new Hono<AppEnv>()

costsRoutes.get('/:id/costs', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const rows: CostDto[] = await db.select({
    id: expectedCosts.id,
    name: expectedCosts.name,
    frequency: expectedCosts.frequency,
    currency: expectedCosts.currency,
    amount: expectedCosts.amount,
    days: expectedCosts.days
  }).from(expectedCosts).where(eq(expectedCosts.planId, plan.id)).orderBy(asc(expectedCosts.createdAt))
  return c.json(rows)
})

costsRoutes.post('/:id/costs', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const body = await parseJson(c, costInput)
  const [row] = await db.insert(expectedCosts).values({ planId: plan.id, ...body }).returning({ id: expectedCosts.id })
  await touchPlan(plan.id)
  return c.json({ id: row!.id })
})

costsRoutes.patch('/:id/costs/:costId', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const costId = c.req.param('costId')
  const body = await parseJson(c, costInput)
  const [row] = isUuid(costId)
    ? await db.update(expectedCosts).set(body)
        .where(and(eq(expectedCosts.id, costId), eq(expectedCosts.planId, plan.id))).returning({ id: expectedCosts.id })
    : []
  if (!row) throw httpError(404, 'cost_not_found')
  await touchPlan(plan.id)
  return c.json({ id: row.id })
})

costsRoutes.delete('/:id/costs/:costId', async (c) => {
  const plan = await requirePlan(c.get('user').id, c.req.param('id'))
  const costId = c.req.param('costId')
  const [row] = isUuid(costId)
    ? await db.delete(expectedCosts)
        .where(and(eq(expectedCosts.id, costId), eq(expectedCosts.planId, plan.id))).returning({ id: expectedCosts.id })
    : []
  if (!row) throw httpError(404, 'cost_not_found')
  await touchPlan(plan.id)
  return c.json({ ok: true })
})
