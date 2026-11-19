import { Hono } from 'hono'
import { httpError } from '../http/errors.ts'
import { exportContext, slugify } from '../lib/export-context.ts'
import { loadPlanBudget } from '../lib/fx.ts'
import { buildItineraryPdf } from '../lib/pdf-itinerary.ts'
import { buildTicketsPdf } from '../lib/pdf-tickets.ts'
import { requirePlan } from '../lib/plans.ts'
import { loadTickets } from '../lib/tickets.ts'
import { buildItineraryXlsx } from '../lib/xlsx-itinerary.ts'
import type { AppEnv } from '../types.ts'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const exportsRoutes = new Hono<AppEnv>()

exportsRoutes.get('/:id/export/:kind', async (c) => {
  const user = c.get('user')
  const plan = await requirePlan(user.id, c.req.param('id'))
  const kind = c.req.param('kind')
  const ctx = exportContext(user, plan)
  const slug = slugify(plan.name)

  let body: Buffer
  let contentType = 'application/pdf'
  let filename: string
  if (kind === 'itinerary-pdf') {
    body = await buildItineraryPdf(ctx, await loadPlanBudget(plan))
    filename = `${slug}-itinerary.pdf`
  } else if (kind === 'itinerary-xlsx') {
    body = await buildItineraryXlsx(ctx, await loadPlanBudget(plan))
    contentType = XLSX
    filename = `${slug}-itinerary.xlsx`
  } else if (kind === 'tickets-pdf') {
    const tickets = await loadTickets(plan.id)
    if (tickets.length === 0) throw httpError(404, 'no_tickets')
    body = await buildTicketsPdf(ctx, tickets)
    filename = `${slug}-tickets.pdf`
  } else {
    throw httpError(404, 'not_found')
  }

  return c.body(new Uint8Array(body), 200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store'
  })
})
