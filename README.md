# Multi-Tenant E-Commerce Platform

Frontend foundation for a backend-agnostic commerce platform with independent
tenant storefronts, tenant workspaces, host workspaces, and a Super Admin
platform workspace.

## Requirements

- Node.js 20.19 or later (required by the selected Next.js and tooling versions)
- npm

## Getting started

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local`, then generate and configure a 32-byte
`PLATFORM_SECRET_KEY`, a 32-character-or-longer `SESSION_SECRET`, and a random
one-time `SETUP_TOKEN` (at least 32 characters). For example, run this in
PowerShell after copying the file:

```powershell
$key = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
$session = node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
$setup = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
Add-Content .env.local "PLATFORM_SECRET_KEY=$key"
Add-Content .env.local "SESSION_SECRET=$session"
Add-Content .env.local "SETUP_TOKEN=$setup"
```

The local JSON PlatformStore is development-only and writes to `.local/`, which
is ignored by Git. Open `/en/setup` (or `/setup`, which redirects there) to
create the first Super Admin and enroll TOTP. Save the recovery codes when
shown.

For a deployment, set `PLATFORM_STORE=supabase`, configure
`PLATFORM_SUPABASE_URL` and `PLATFORM_SUPABASE_SERVICE_KEY` as server-only
secrets, and apply the reviewed migrations in `supabase/migrations/` before
starting the app. Remove or rotate `SETUP_TOKEN` after setup.

Open [http://localhost:3000](http://localhost:3000); the app redirects to its
English locale at `/en`. The current home page is a foundation placeholder.
Tenant data-provider implementations and domain resolution are still being
built.

## Commands

```bash
npm run lint
npm run typecheck
npm test
npm run format:check
npm run build
```

## Architecture

- `src/app/` — Next.js App Router routes and layouts
- `src/core/` — domain types, schemas, ports, and tenancy rules
- `src/adapters/` — backend, payment, and storage implementations
- `src/features/` — feature modules and application services
- `src/components/` — shared UI
- `src/i18n/` — locale routing and request configuration
- `messages/` — translation dictionaries
- `supabase/migrations/` — platform-store schema and bootstrap functions

Tenant configuration and authorization must be resolved on the server. Do not
put tenant secrets in client code or call tenant backends directly from the
browser. See [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) for the full project
requirements and security boundaries.
