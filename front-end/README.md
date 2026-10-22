# Multi-Tenant E-Commerce Platform Frontend

Backend-agnostic frontend for a multi-tenant commerce platform with independent
tenant storefronts, tenant workspaces, host workspaces, and a Super Admin
platform workspace.

## Requirements

- Node.js 20.19.0 or later (Node.js 22 LTS or later recommended)
- npm

## Getting started

Run these commands from the `front-end` directory:

```powershell
node --version
npm install
Copy-Item .env.example .env.local
```

If npm reports `EBADENGINE`, update Node.js and reopen the terminal. For
example, `entities@8` requires Node.js 20.19.0 or later.

Generate and configure a 32-byte `PLATFORM_SECRET_KEY`, a 32-character-or-
longer `SESSION_SECRET`, and a random one-time `SETUP_TOKEN` (at least 32
characters). In PowerShell:

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

After signing in at `/en/super-admin`, create host workspaces, set their
initial plan and limits, and activate or suspend them. Host-owner invitations
and a host-scoped tenant management portal are available:

1. Activate a host in the Super Admin dashboard.
2. Invite its owner and securely share the one-time invitation URL. Email
   delivery is not configured, so the link must be sent manually.
3. Open the link, choose a password of at least 14 characters, and sign in at
   `/en/host/login` (acceptance also signs the owner in).
4. Use `/en/host` to create, activate, or suspend tenants within the host's
   configured limits.
5. From an active tenant's row, invite its Tenant Owner and securely share the
   one-time link. The owner sets a password and signs in at `/en/tenant`, where
   they can edit the store display name, description, logo URL, brand colors,
   supported locales, and currencies.
6. Tenant Owners can configure an HTTPS REST backend from Store setup. Enter
   the versioned API base URL and API key, save, then test the saved connection.
   The health check sends `X-API-Key` to `/{apiVersion}/health`, rejects private
   and internal DNS targets, pins the resolved public address, and never returns
   the key to the browser. The optional local demo exception is documented
   below.

Tenant settings are applied to the storefront preview. REST connection setup,
health testing, tenant-scoped catalog CRUD, and Stripe-hosted checkout in
test mode are implemented. Storefront/domain provisioning, live payments,
tenant-specific Stripe Connect accounts, storage, tax, and shipping are not
yet implemented. Invitation links must be shared manually until email
delivery is configured.

The tenant product API supports `GET`/`POST /api/tenant/products` and
`GET`/`PATCH`/`DELETE /api/tenant/products/:productId`. It proxies to the
configured tenant backend's `/{apiVersion}/products` endpoint through a
server-side catalog adapter; requests require a Tenant Owner session. The
backend URL is resolved and pinned to public IPs for each request, redirects
are not followed, response sizes/time are bounded, and product IDs and returned
tenant scopes are validated.

To try the product API locally, sign in as a Tenant Owner, connect a reachable
REST backend in Store setup, then run this in the browser's developer console:

```js
const response = await fetch("/api/tenant/products?page=1&limit=20");
console.log(response.status, await response.json());
```

The catalog request uses the saved backend key server-side. Production and
regular development configurations require a public HTTPS backend. An explicit
development-only opt-in (`TENANT_REST_ALLOW_LOCAL_HTTP=true`) allows HTTP only
to `localhost`, `127.0.0.1`, or `::1` with an explicit port; arbitrary private
addresses, DNS names, and all production HTTP targets remain blocked.

## End-to-end demo data

From the repository root, generate a separate demo environment:

```powershell
npm run seed:demo
```

The command refuses to overwrite any existing demo files. It leaves the
existing `.local/platform-store.json`, `.env.local`, and default tenant
database untouched. The generated demo store and credentials are Git-ignored.
In separate terminals from the repository root, start the API and website:

```powershell
npm run tenant-backend:demo
npm run dev:demo
```

Open `http://store.localhost:3000/en` to browse the sample catalog. The
credentials and Super Admin TOTP secret are in
`.local/demo-credentials.txt` (under this `front-end` directory). Sign in to
the tenant workspace at `http://store.localhost:3000/en/tenant`; host and
platform owner portals are available at their respective `host.localhost` and
`localhost` hostnames. Use the port printed by Next.js if it selects a port
other than 3000. On Windows, if `store.localhost` does not resolve, add
`127.0.0.1 store.localhost host.localhost` to
`C:\Windows\System32\drivers\etc\hosts` using an elevated editor, then retry.
The local HTTP exception is enabled only by the generated demo environment and
is rejected in production.

To reseed, stop the demo servers and manually remove only these files:
`front-end/.local/demo-platform-store.json`,
`front-end/.local/demo-credentials.txt`, `front-end/.env.demo`,
`tenant-back-end/.env.demo`, and `tenant-back-end/data/demo-tenant.sqlite`
(including its `-shm` and `-wal` sidecars if present). Do not remove
`.local/platform-store.json` or your normal `.env.local`.

For production, set `PLATFORM_STORE=supabase`, configure
`PLATFORM_SUPABASE_URL` and `PLATFORM_SUPABASE_SERVICE_KEY` as server-only
secrets, and apply the reviewed migrations in `supabase/migrations/` before
starting the app. Remove `SETUP_TOKEN` after setup.

Start the frontend from this directory with `npm run dev`, or from the
repository root with `npm run dev`. Open [http://localhost:3000](http://localhost:3000);
the app redirects to its English locale at `/en`.

## Commands

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run format:check
npm run build
```

The Tenant order Playwright test starts an isolated frontend and SQLite Tenant
backend with temporary fixture data, then removes that fixture when the test
server exits. It covers Owner and Staff access, read-only enforcement,
cross-Tenant order isolation, and status propagation to Customer order history.
The API route test also verifies retry after the Tenant backend status changes
but the platform order-history update temporarily fails.

## Stripe test checkout

Configure a Stripe test-mode secret key and webhook signing secret in the
frontend environment:

```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

For local testing, forward Stripe test events to
`http://localhost:3000/api/webhooks/stripe` with the Stripe CLI and use a test
card such as `4242 4242 4242 4242`. Checkout redirects to Stripe-hosted
Checkout. The server calculates the amount from current catalog prices, and
the order is sent to the Tenant backend only after the signed webhook confirms
payment. The browser redirect itself is never considered payment proof.

Apply `supabase/migrations/0011_customer_order_payments.sql` when using
Supabase. The configured integration is test-mode only; live Stripe keys are
rejected. One platform-level Stripe account is used for this initial slice;
tenant-specific Stripe Connect onboarding and live payment operations remain
future work.

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
browser. See [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) for full project
requirements and security boundaries. See
[PROJECT_STATUS_AND_PLATFORM_STORE.md](./PROJECT_STATUS_AND_PLATFORM_STORE.md)
for the completed/pending task list and detailed platform-store guide.
