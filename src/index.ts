import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { cleanupExpired } from './auth/sessions.ts'
import { env } from './env.ts'

const HOUR = 3600_000

function cleanup() {
  cleanupExpired().catch(error => console.error('[cleanup]', error))
}

cleanup()
setInterval(cleanup, HOUR).unref()

serve({ fetch: createApp().fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`rencana-backend listening on http://${info.address}:${info.port}`)
})
