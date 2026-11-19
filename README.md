# rencana-backend

API for **Rencana**, the travel & budget planner with Koper the suitcase. It serves the web SPA ([`rencana-web`](https://github.com/zuramai/rencana-web)) and the Kotlin Multiplatform app ([`rencana-mobile`](https://github.com/zuramai/rencana-mobile)).

Stack: [Hono](https://hono.dev) on Node 24 (native TypeScript, no build step), Postgres via Drizzle ORM, S3-compatible object storage (MinIO in development), pdfmake / pdf-lib / exceljs for exports.

## Setup

Prerequisites: Node ≥ 24.11 (`.nvmrc`), pnpm, Postgres 16, an S3-compatible bucket.

```bash
pnpm install
cp .env.example .env          # fill in COOKIE_SECRET: openssl rand -base64 48
pnpm db:migrate
pnpm s3:init                  # creates the bucket if missing
pnpm dev                      # http://127.0.0.1:8787
```

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables `__Host-` cookies, HSTS and https-only URL checks |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Listen address |
| `DATABASE_URL` | — | Postgres connection string |
| `WEB_ORIGINS` | `http://localhost:3000` | Comma-separated browser origins allowed by CORS and the cookie Origin check |
| `WEB_APP_URL` | first `WEB_ORIGINS` entry | Where Google sign-in returns web users |
| `COOKIE_SECRET` | — | ≥ 32 chars, signs the OAuth state cookie |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate limiting (only behind a trusted proxy) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | empty | Google sign-in; set both or neither |
| `GOOGLE_REDIRECT_URL` | `http://localhost:8787/auth/google/callback` | Must be registered in Google Cloud |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | | Object storage |

## Scripts

- `pnpm dev` / `pnpm start`
- `pnpm test` — unit tests plus auth/security integration tests against `postgres://localhost:5432/rencana_test` (override with `TEST_DATABASE_URL`; create it with `createdb rencana_test`, migrations run automatically)
- `pnpm typecheck`, `pnpm lint`
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations in `src/db/migrations`

## Authentication

- **Web**: opaque session token in an `HttpOnly`, `SameSite=Strict` cookie (`__Host-rencana_session` in production), 7-day idle / 30-day absolute expiry. Login, register, logout and every cookie-authenticated write require an `Origin` listed in `WEB_ORIGINS`.
- **Mobile** (`/api/mobile/auth/*`): `Authorization: Bearer` access tokens (15 min) with rotating refresh tokens (30-day idle, 90-day absolute). Reusing a rotated refresh token revokes the session.
- Only SHA-256 hashes of tokens are stored. Passwords use argon2id; legacy scrypt hashes are upgraded on the next login.
- Google sign-in uses PKCE + nonce, verifies the ID token with `jose`, and hands mobile clients a single-use, PKCE-bound code via `com.zuramai.rencana:/oauth/callback`.
- In-memory rate limits on login, register, token and all `/api/*` routes (per process; multi-instance deployments need a shared store).

Files are streamed through the API (`GET /api/files/:id[?size=thumb]`) after an ownership check; the bucket is never exposed.

## Shared code

`src/shared/` (schemas, budget/money/period/itinerary utils, DTO types) is the canonical copy. `rencana-web/shared/` mirrors the client-used parts; change both. `rencana-mobile` ports the needed parts to Kotlin.

## Deployment

The web app and the API must share a registrable domain (e.g. `app.example.com` + `api.example.com`): the web session cookie is `SameSite=Strict` and is not sent across unrelated sites. Mobile clients are unaffected. Run behind TLS; set `NODE_ENV=production`.
