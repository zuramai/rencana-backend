import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { itineraryItems, plans, type PlanRow } from '../db/schema.ts'
import { httpError } from '../http/errors.ts'

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/** The plan with `planId` owned by `userId`, else 404 `plan_not_found`. */
export async function requirePlan(userId: string, planId: string | undefined): Promise<PlanRow> {
  const plan = planId && isUuid(planId)
    ? await db.query.plans.findFirst({ where: and(eq(plans.id, planId), eq(plans.userId, userId)) })
    : undefined
  if (!plan) throw httpError(404, 'plan_not_found')
  return plan
}

/** Item/cost/ticket writes mark the plan as recently updated (list order). */
export async function touchPlan(planId: string): Promise<void> {
  await db.update(plans).set({ updatedAt: sql`now()` }).where(eq(plans.id, planId))
}

/** Item `itemId` of plan `planId`, else 404 `item_not_found`. */
export async function findItem(planId: string, itemId: string | undefined) {
  const item = itemId && isUuid(itemId)
    ? await db.query.itineraryItems.findFirst({ where: and(eq(itineraryItems.id, itemId), eq(itineraryItems.planId, planId)) })
    : undefined
  if (!item) throw httpError(404, 'item_not_found')
  return item
}
