import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import { requireAuth } from './auth/middleware.ts'
import { env, isProduction } from './env.ts'
import { httpError, notFound, onError } from './http/errors.ts'
import { createLimiters } from './http/limits.ts'
import { clientIp, enforce } from './http/rate-limit.ts'
import { authMobileRoutes } from './routes/auth-mobile.ts'
import { authWebRoutes } from './routes/auth-web.ts'
import { costsRoutes } from './routes/costs.ts'
import { exportsRoutes } from './routes/exports.ts'
import { filesRoutes } from './routes/files.ts'
import { googleRoutes } from './routes/google.ts'
import { itemsRoutes } from './routes/items.ts'
import { meRoutes } from './routes/me.ts'
import { plansRoutes } from './routes/plans.ts'
import { ticketsRoutes } from './routes/tickets.ts'
import type { AppEnv } from './types.ts'

const KB = 1024
const MB = 1024 * KB

/** Logs method, path (never the query string: OAuth codes live there), status and duration. */
const accessLog = createMiddleware<AppEnv>(async (c, next) => {
  const start = performance.now()
  await next()
  console.log(`${c.get('requestId')} ${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - start)}ms`)
})

function sizedBodyLimit(maxSize: number) {
  return bodyLimit({
    maxSize,
    onError: () => {
      throw httpError(413, 'file_too_large')
    }
  })
}

export function createApp() {
  const app = new Hono<AppEnv>()
  const limiters = createLimiters()

  app.use(requestId())
  if (env.NODE_ENV !== 'test') app.use(accessLog)
  app.use(secureHeaders({
    xFrameOptions: 'DENY',
    referrerPolicy: 'no-referrer',
    crossOriginResourcePolicy: 'same-site',
    crossOriginOpenerPolicy: 'same-origin',
    strictTransportSecurity: isProduction ? 'max-age=31536000; includeSubDomains' : false
  }))

  app.use('/api/*', cors({
    origin: env.WEB_ORIGINS,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Disposition'],
    maxAge: 600
  }))
  app.use('/api/*', async (c, next) => {
    await next()
    // The browser PDF viewer breaks under a restrictive CSP on the file itself.
    if (!c.req.path.startsWith('/api/files/')) {
      c.res.headers.set('Content-Security-Policy', 'default-src \'none\'; frame-ancestors \'none\'')
    }
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store')
  })
  app.use('/api/*', async (c, next) => {
    enforce(limiters.api, clientIp(c))
    await next()
  })

  const jsonLimit = sizedBodyLimit(64 * KB)
  const imageLimit = sizedBodyLimit(12 * MB)
  const ticketLimit = sizedBodyLimit(80 * MB)
  app.use('/api/*', (c: Context, next) => {
    const path = c.req.path
    if (/^\/api\/plans\/[^/]+\/tickets(\/[^/]+)?$/.test(path)) return ticketLimit(c, next)
    if (/^\/api\/plans(\/[^/]+)?$/.test(path) || /^\/api\/plans\/[^/]+\/items(\/[^/]+)?$/.test(path)) return imageLimit(c, next)
    return jsonLimit(c, next)
  })

  app.get('/healthz', c => c.json({ ok: true, service: 'rencana' }))

  app.route('/api/auth', authWebRoutes(limiters))
  app.route('/api/mobile/auth', authMobileRoutes(limiters))
  app.route('/auth/google', googleRoutes(limiters))
  app.route('/api/me', meRoutes)

  const plansApi = new Hono<AppEnv>()
  plansApi.use('*', requireAuth)
  plansApi.route('/', plansRoutes)
  plansApi.route('/', itemsRoutes)
  plansApi.route('/', costsRoutes)
  plansApi.route('/', ticketsRoutes)
  plansApi.route('/', exportsRoutes)
  app.route('/api/plans', plansApi)

  const filesApi = new Hono<AppEnv>()
  filesApi.use('*', requireAuth)
  filesApi.route('/', filesRoutes)
  app.route('/api/files', filesApi)

  app.onError(onError)
  app.notFound(notFound)
  return app
}
