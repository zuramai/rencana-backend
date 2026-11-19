import { Scrypt } from '@adonisjs/hash/drivers/scrypt'
import { hash, verify, type Options } from '@node-rs/argon2'

/** `Algorithm.Argon2id` (2); the const enum can't be imported under `verbatimModuleSyntax`. */
const ARGON2: Options = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 }
const legacyScrypt = new Scrypt({})

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2)
}

/**
 * Verifies argon2id hashes and legacy nuxt-auth-utils scrypt PHC strings.
 * `rehash` asks the caller to upgrade a legacy hash after a successful login.
 */
export async function verifyPassword(stored: string, password: string): Promise<{ ok: boolean, rehash: boolean }> {
  try {
    if (stored.startsWith('$argon2id$')) return { ok: await verify(stored, password), rehash: false }
    if (stored.startsWith('$scrypt$')) {
      const ok = await legacyScrypt.verify(stored, password)
      return { ok, rehash: ok }
    }
  } catch {
    // Malformed hash: treat as a failed verification.
  }
  return { ok: false, rehash: false }
}

let dummy: Promise<string> | undefined

/** Spend the same work as a real verification when the user does not exist. */
export async function verifyDummy(password: string): Promise<void> {
  dummy ??= hashPassword('rencana-dummy-password')
  await verify(await dummy, password).catch(() => false)
}
