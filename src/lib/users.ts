import type { UserRow } from '../db/schema.ts'
import type { MeDto, SessionUser } from '../types.ts'

export function sessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    locale: row.locale === 'id' ? 'id' : 'en',
    defaultCurrency: row.defaultCurrency
  }
}

export function meDto(row: UserRow): MeDto {
  return { ...sessionUser(row), username: row.username, email: row.email }
}
