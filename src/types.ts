import type { SessionRow } from './db/schema.ts'

export interface SessionUser {
  id: string
  displayName: string
  avatarUrl: string | null
  locale: 'en' | 'id'
  defaultCurrency: string
}

export interface MeDto extends SessionUser {
  username: string | null
  email: string | null
}

export interface AppEnv {
  Variables: {
    user: SessionUser
    session: SessionRow
    authVia: 'cookie' | 'bearer'
    requestId: string
  }
}
