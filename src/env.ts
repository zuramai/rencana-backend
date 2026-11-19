import { z } from 'zod'

const bool = z.enum(['true', 'false']).default('false').transform(v => v === 'true')
const optional = z.string().trim().optional().transform(v => (v ? v : undefined))

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGINS: z.string().default('http://localhost:3000').transform((value, ctx) => {
    const origins: string[] = []
    for (const raw of value.split(',').map(s => s.trim()).filter(Boolean)) {
      try {
        origins.push(new URL(raw).origin)
      } catch {
        ctx.addIssue({ code: 'custom', message: `invalid origin "${raw}"` })
        return z.NEVER
      }
    }
    if (origins.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'at least one origin is required' })
      return z.NEVER
    }
    return origins
  }),
  WEB_APP_URL: optional.pipe(z.url().optional()),
  COOKIE_SECRET: z.string().min(32, 'must be at least 32 characters'),
  TRUST_PROXY: bool,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GOOGLE_REDIRECT_URL: z.url().default('http://localhost:8787/auth/google/callback'),
  S3_ENDPOINT: optional,
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool
}).superRefine((e, ctx) => {
  if (!!e.GOOGLE_CLIENT_ID !== !!e.GOOGLE_CLIENT_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_SECRET'], message: 'set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither' })
  }
  if (e.NODE_ENV === 'production') {
    const urls: [string, string[]][] = [
      ['WEB_ORIGINS', e.WEB_ORIGINS],
      ['WEB_APP_URL', e.WEB_APP_URL ? [e.WEB_APP_URL] : []],
      ['GOOGLE_REDIRECT_URL', [e.GOOGLE_REDIRECT_URL]]
    ]
    for (const [name, values] of urls) {
      if (values.some(v => !v.startsWith('https:'))) {
        ctx.addIssue({ code: 'custom', path: [name], message: 'must use https: in production' })
      }
    }
  }
}).transform(e => ({
  ...e,
  WEB_APP_URL: (e.WEB_APP_URL ?? e.WEB_ORIGINS[0]!).replace(/\/$/, ''),
  googleEnabled: !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET)
}))

function load() {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map(i => `  - ${i.path.join('.') || '(env)'}: ${i.message}`)
    console.error(`Invalid environment configuration:\n${lines.join('\n')}`)
    process.exit(1)
  }
  return parsed.data
}

export const env = load()
export const isProduction = env.NODE_ENV === 'production'
