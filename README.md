# Multi-Tenant E-Commerce Platform

Frontend foundation for a backend-agnostic commerce platform with independent
tenant storefronts, tenant workspaces, host workspaces, and a Super Admin
platform workspace.

## Requirements

- Node.js 20.19.0 or later (Node.js 22 LTS or later recommended)
- npm

## Getting started

Check the active Node.js version before installing dependencies:

```bash
node --version
```

If npm reports `EBADENGINE`, update Node.js to a supported version and reopen
the terminal so `node --version` shows the new version. For example, the
`entities@8` dependency requires Node.js 20.19.0 or later; do not suppress the
warning or downgrade the dependency to work around an outdated Node.js runtime.

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

After signing in at `/en/super-admin`, you can create host workspaces, set
their initial plan and limits, and activate or suspend them. Host-owner
invitations and a host-scoped tenant management portal are available:

1. Activate a host in the Super Admin dashboard.
2. Invite its owner and securely share the one-time invitation URL. Email
   delivery is not configured, so the link must be sent manually.
3. Open the link, choose a password of at least 14 characters, and sign in at
   `/en/host/login` (acceptance also signs the owner in).
4. Use `/en/host` to create, activate, or suspend tenants within the host's
   configured limits.
5. From an active tenant’s row, invite its Tenant Owner and securely share the
   one-time link. The owner sets a password and signs in at `/en/tenant`, where
   they can edit the store display name, description, logo URL, brand colors,
   supported locales, and currencies.
6. Tenant Owners can configure an HTTPS REST backend from Store setup. Enter
   the versioned API base URL and API key, save, then test the saved connection.
   The first slice sends `X-API-Key` to `/{apiVersion}/health`, rejects private
   and internal DNS targets, pins the resolved public address for the HTTPS
   request, and never returns the key to the browser.

Tenant settings are platform metadata only and do not yet apply a live
storefront theme. REST connection setup and health testing are implemented, but
tenant-scoped REST catalog operations are available through the authenticated
`/api/tenant/products` API. A product-management screen, storefront
provisioning, payments, storage, and custom-domain routing are not yet
implemented. Email delivery is not configured for either invitation flow, so
links must be shared manually.

The tenant product API supports `GET`/`POST /api/tenant/products` and
`GET`/`PATCH`/`DELETE /api/tenant/products/:productId`. It proxies to the
configured tenant backend's `/{apiVersion}/products` endpoint through the
server-side catalog adapter; requests require a Tenant Owner session. The
backend URL is resolved and pinned to public IPs for each request, redirects are
not followed, response sizes/time are bounded, and product IDs and returned
tenant scopes are validated.

To try the product API locally, sign in as a Tenant Owner, connect a reachable
REST backend in Store setup, then run this in the browser's developer console:

```js
const response = await fetch("/api/tenant/products?page=1&limit=20");
console.log(response.status, await response.json());
```

The catalog request uses the saved backend key server-side. `localhost` can
host the platform app, but the backend connection itself must have a public
HTTPS hostname because private/internal targets are blocked.

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
requirements and security boundaries. See
[PROJECT_STATUS_AND_PLATFORM_STORE.md](./PROJECT_STATUS_AND_PLATFORM_STORE.md)
for the completed/pending task list and detailed file/Supabase configuration
guide.
