# Project Status and Platform Store Guide

This document records what is implemented, what remains on the project
roadmap, and how to configure the platform's own persistent store. It reflects
the current repository implementation; items in the project context are not
automatically implemented just because they are listed there.

## Current status

Status snapshot as of 2026-10-21:

- The frontend platform bootstrap, Super Admin onboarding, host/tenant
  lifecycle management, and scoped portal auth flows are in place and working
  for the current app surface.
- The file-store developer path is fully usable locally; the Supabase platform
  store is the supported production path once the required migration set is
  applied.
- REST backend connection validation, health checks, and the authenticated
  tenant product API are implemented and protected by tenant-scoped server-side
  checks.
- Tenant branding/locale metadata is persisted and applied to the tenant
  storefront landing preview; custom-domain provisioning, commerce runtime, and
  provider-level storefront setup remain future work.
- The repo remains frontend-only; tenant data providers, full storefront
  commerce runtime, payments, and storage are still pending beyond the current
  platform and integration scaffolding.

### Completed

- [x] Next.js App Router foundation with strict TypeScript, Tailwind CSS,
      English locale routing, TanStack Query provider, linting, formatting, and
      Vitest.
- [x] `PlatformStore` port and server-only factory.
- [x] Local JSON platform store for development, with atomic file writes and
      file locking.
- [x] Supabase platform store adapter using a fixed server-configured project.
- [x] One-time Super Admin bootstrap, Argon2id password hash, mandatory TOTP,
      one-use recovery codes, rate limits, audit events, and secure session cookie.
- [x] AES-256-GCM encrypted secret vault.
- [x] Super Admin sign-in page and initial protected dashboard.
- [x] Host management first slice: create and list hosts, assign an initial
      plan and tenant/domain limits, and activate or suspend hosts.
- [x] Host API authorization, same-origin checks, rate limits, input
      validation, duplicate slug/domain checks, and audit logging.
- [x] Authenticated host/Super Admin mutation throttles use per-account
      buckets in addition to client-address scoping; invalid host/tenant create
      requests do not consume the valid-change quota.
- [x] Host Owner invitation and authentication with single-use, expiring
      invitations, Argon2id passwords, host-scoped sessions, and host
      suspension checks.
- [x] Host portal tenant metadata management with host-scoped reads and writes,
      status changes, audit events, and tenant/domain limit enforcement.
- [x] Tenant Owner invitations issued by the managing Host Owner, one-time
      acceptance, Argon2id passwords, scoped sessions, and status checks.
- [x] Initial Tenant Owner portal with scoped store metadata, assigned domains,
      and a clear notice that backend/storefront provisioning is not available.
- [x] Tenant Owner brand and locale settings with validated HTTPS logo URLs,
      color tokens, locale/currency codes, tenant-scoped persistence, and audit
      events.
- [x] Tenant storefront landing page uses saved branding and locale metadata
      when resolving a tenant domain, rendering a branded preview shell while
      the commerce experience remains intentionally unavailable.
- [x] Tenant Owner REST backend connection setup with HTTPS URL/version
      validation, encrypted write-only API-key storage, tenant-scoped
      persistence, and audit events.
- [x] REST health test using `X-API-Key`, private/internal DNS rejection,
      pinned public DNS address, no redirects, response-size/time limits, and
      per-account rate limiting.
- [x] Versioned REST catalog adapter for product list/read/create/update/delete
      with server-only API-key access, tenant-scoped BFF routes, contract
      validation, and mutation rate limits.
- [x] Supabase platform schema migrations for bootstrap, hosts, and the Host
      Owner/tenant portal, Tenant Owner accounts/invitations, and tenant
      settings.
- [x] Data and storage port/factory contracts. These are extension points, not
      complete tenant provider implementations.
- [x] Host and tenant configuration lookup ports, backed by the existing
      file and Supabase platform-store adapters. These provide exact-domain
      lookups for request-time scope resolution.
- [x] Request-time domain resolution across localized pages and authenticated
      requests. Registered active host and tenant domains receive typed scopes;
      tenant resolution also checks that its host is active. Resolution uses
      exact normalized domains and does not cache request scopes.

### Partially complete

- [x] **Tenant product management:** the tenant portal now includes a
      catalog screen for listing, creating, editing, and deleting products via
      the tenant-scoped REST API adapter.
- [ ] **Setup wizard:** creates the first Super Admin and enrolls TOTP, but
      does not yet guide the operator through connection verification, email
      setup, theme/legal settings, or first-host creation. Platform-store
      credentials are configured outside the wizard.
- [ ] **Super Admin dashboard:** host creation/status management works;
      editing host details, deletion, invitations, staff/roles, settings, health,
      analytics, domains, billing, and audit-log views remain.
- [ ] **Host and tenant architecture:** basic Host Owner authentication and
      tenant metadata management and an initial Tenant Owner portal are
      implemented. Tenant-specific configuration stores, tenant storefront
      routing and provisioning, tenant backends, products, staff roles, and
      expanded RBAC remain. Branding/locale settings are now applied to the
      tenant-domain landing preview, while the full customer storefront,
      custom domain routing, and commerce runtime remain future work.
      Resolved domain scopes apply to all localized pages and authenticated
      portal requests. Tenant-aware cache invalidation remains future work; no
      tenant data is currently cached.
- [ ] **i18n:** routing infrastructure exists, but only English is configured.
      The tenant storefront preview uses the saved default locale metadata but
      does not yet expand the public storefront to localized customer pages.
- [ ] **Security/operations:** authentication and mutation protections exist
      for current flows. Rate limits use the configured PlatformStore and
      mutation limits are per-account; production monitoring, a shared
      distributed rate-limit service, automated migration deployment,
      backup/restore, and full security headers still need work.

### Pending roadmap

#### Foundation and tenancy

- [ ] Choose a separate host/tenant configuration persistence owner if these
      records need to move outside the platform store; lookup ports currently
      use the platform store as their source of truth.
- [x] Apply trusted domain scopes across localized pages and authenticated
      platform, host, and tenant requests.
- [ ] Add tenant-aware cache invalidation and prevent cross-tenant cache reuse
      when tenant data is introduced into a cache.
- [ ] Complete server-enforced RBAC and scoped access checks for platform,
      host, tenant, staff, and customer roles.
- [ ] Provision tenant storefronts and domains; extend the initial Tenant Owner
      portal with backend, storage, payment, catalog, and staff settings.
- [ ] Complete the setup wizard's connection check, reserved-domain
      configuration, email provider, theme/legal settings, and optional
      first-host steps.
- [ ] Add automated Supabase migration and deployment checks.

#### Tenant data and integrations

- [x] Add local product-management screen for catalog CRUD. REST connection,
      health testing, catalog adapter, and authenticated product API routes are
      implemented; end-to-end mock coverage remains as a follow-up enhancement.
- [ ] Implement tenant Supabase and MongoDB data adapters, reference schemas,
      provider setup, test-connection, and schema initialization.
- [ ] Add connection testing for other providers and full credential rotation
      workflows. REST API-key replacement is supported; OAuth/JWT are not.
- [ ] Implement payment adapters (initial targets: Stripe, a regional gateway,
      and Cash on Delivery), server-side payment verification, and webhook
      handling.
- [ ] Implement a storage adapter (initial target: S3-compatible), upload
      validation including file type/content checks, and scoped file paths.
- [ ] Add additional storage providers based on the v1 scope.

#### Commerce experiences

- [ ] Product/catalog CRUD, variants, categories, and image management.
- [ ] Orders, customers, inventory, discounts, shipping, and tax workflows.
- [ ] Tenant storefront, search, cart, checkout, order confirmation, and
      customer account.
- [ ] Host and Super Admin domain management, plans/limits, health, audit,
      analytics, and platform settings.
- [ ] Later growth work: CMS, reviews, reporting, staff permissions, webhooks,
      PWA, and theming tools.

#### Production decisions and hardening

- [ ] Choose background jobs, email delivery, custom-domain/SSL strategy,
      tenant-aware caching, and customer identity model.
- [ ] Define inventory reservation and payment-failure behavior.
- [ ] Add observability, CI/CD, dependency/license scanning, SBOM and third-
      party notices, backups, tenant export/deletion, and compliance workflows.
- [ ] Decide whether tenants may move between hosts or data providers, how
      migrations work, and which compliance regions/data residency are required.

## Platform store options: implementation reality

`PLATFORM_STORE` currently accepts only:

| Value                         | Implemented | Use                                                                                                                                                                                        |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `file`                        | Yes         | Local development only. JSON file; not suitable for production, serverless, multiple instances, or shared concurrent writers.                                                              |
| `supabase`                    | Yes         | Platform records stored in the dedicated Supabase project configured with server-only environment variables. This is the only currently supported production option.                       |
| `kv`, `sql`, `mongodb`, `api` | No          | Mentioned as possible future adapters in the project context, but not accepted by the current environment schema or factory. Selecting one is an error; do not configure these values yet. |

The platform store is for **platform-owned data** such as Super Admins, hosts,
setup state, audit events, and encrypted secrets. It is separate from tenant
data projects. Tenant data adapters and tenant database credentials are not
implemented by selecting a platform-store option.

## Environment variables

| Variable                        | Required                                             | Purpose                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLATFORM_STORE`                | No; defaults to `file`                               | Must be `file` or `supabase`.                                                                                                                               |
| `PLATFORM_STORE_FILE`           | No                                                   | Local JSON file path when using `file`. Defaults to `.local/platform-store.json`, relative to the project working directory.                                |
| `PLATFORM_SUPABASE_URL`         | When using `supabase`                                | URL of the dedicated platform Supabase project.                                                                                                             |
| `PLATFORM_SUPABASE_SERVICE_KEY` | When using `supabase`                                | Server-only service key. Never use a `NEXT_PUBLIC_` prefix or send it to the browser.                                                                       |
| `PLATFORM_SECRET_KEY`           | Required in production; needed for secret encryption | Exactly 32 bytes, encoded as 64 hexadecimal characters or base64. Used for TOTP and vault encryption; losing it makes encrypted values unreadable.          |
| `SESSION_SECRET`                | Required in production; needed for sessions          | At least 32 characters. Signs Super Admin session tokens; changing it invalidates existing sessions.                                                        |
| `SETUP_TOKEN`                   | Before initial setup                                 | Random, single-use bootstrap proof, at least 32 characters. Remove it from the deployment environment after setup completes.                                |
| `NEXT_PUBLIC_PLATFORM_DOMAIN`   | Optional                                             | Public platform hostname setting. It is not a tenant-domain resolver; the current setup flow persists the platform domain that is entered during bootstrap. |
| `NODE_ENV`                      | Set by Next.js                                       | Use the standard `development`, `test`, or `production` values.                                                                                             |

Do not put tenant-specific backend, storage, or payment secrets in this file;
those belong in the encrypted vault after the corresponding integration
features are implemented.

## Local development with the file store

1. Use Node.js 20.19.0 or later (Node.js 22 LTS is recommended).
2. Copy the example file and install dependencies:

   ```powershell
   Copy-Item .env.example .env.local
   npm install
   ```

3. Generate local secrets in PowerShell and append them to `.env.local`:

   ```powershell
   $key = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   $session = node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   $setup = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   Add-Content .env.local "PLATFORM_SECRET_KEY=$key"
   Add-Content .env.local "SESSION_SECRET=$session"
   Add-Content .env.local "SETUP_TOKEN=$setup"
   ```

   The example already selects `PLATFORM_STORE=file` and sets
   `PLATFORM_STORE_FILE=.local/platform-store.json`.

4. Start the development server:

   ```powershell
   npm run dev
   ```

5. Open `http://localhost:3000/en/setup`, enter the value of `SETUP_TOKEN`,
   create the first Super Admin, and enroll an authenticator. Save the
   recovery codes. After setup, remove `SETUP_TOKEN` from `.env.local`.
6. Sign in at `http://localhost:3000/en/super-admin`, create a host, and
   activate it.
7. Invite its owner and securely share the generated URL; email delivery is
   not configured. Open the link, set a password of at least 14 characters,
   then use `http://localhost:3000/en/host` to manage tenants.
8. Activate a tenant, invite its owner from that tenant's row, and securely
   share the generated link. The owner sets a password of at least 14
   characters and signs in at `http://localhost:3000/en/tenant`.
9. Tenant Owners can save the store display name, description, HTTPS logo URL,
   brand colors, locales, and currencies from Brand and localization.
10. In Store setup, configure the REST backend's HTTPS base URL, API version
    (for example `v1`), and API key. Save, then use **Test saved connection**.
    The tenant backend must expose `GET /{apiVersion}/health` and return JSON
    with a non-empty `status` plus `db` and `storage` set to `up` or `down`.
    Authentication is sent as `X-API-Key`. Leave API key blank to retain it;
    entering a new value rotates it. The value is write-only.
11. A Tenant Owner session can also exercise the catalog API:
    `GET /api/tenant/products?page=1&limit=20`,
    `POST /api/tenant/products`, and
    `GET`/`PATCH`/`DELETE /api/tenant/products/{productId}`. These routes
    proxy product operations to the connected backend. There is not yet a
    product-management UI.

The tenant portal saves branding and locale metadata but does not yet apply it
to a live storefront. REST catalog requests use the saved connection, but
tenant creation does not provision storefronts, databases, or working
custom-domain routes. Health tests and catalog requests reject private/internal DNS
answers (including mixed public/private answers), use a pinned public address,
do not follow redirects, and are limited to five attempts per account per
15-minute window.

The file adapter creates `.local/` as needed. That directory is Git-ignored
and contains platform credentials/state: keep it private and backed up if the
local environment matters. Do not delete or replace
`.local/platform-store.json` to troubleshoot; doing so resets the local
platform and may lock you out. The file adapter uses a lock file and fails
fast when another writer holds the lock; run a single local app instance.
Authenticated mutation limits are tracked separately per account and action.
If an endpoint returns `rate_limited`, wait for its 15-minute window to expire;
restarting the app does not clear persisted counters.

## Production/deployment with Supabase

Use a **dedicated platform Supabase project**, separate from every tenant's
Supabase project. Configure environment values in the hosting provider's
server-side secret settings, not in source control or `NEXT_PUBLIC_*` variables:

```dotenv
PLATFORM_STORE=supabase
PLATFORM_SUPABASE_URL=https://<platform-project-ref>.supabase.co
PLATFORM_SUPABASE_SERVICE_KEY=<server-only-service-key>
PLATFORM_SECRET_KEY=<64-hex-characters-or-32-byte-base64>
SESSION_SECRET=<at-least-32-random-characters>
SETUP_TOKEN=<at-least-32-random-characters-before-first-setup>
NEXT_PUBLIC_PLATFORM_DOMAIN=<your-platform-hostname>
```

Generate secrets on a trusted machine; for example, PowerShell commands in the
local setup section produce suitable values. Put them into the deployment
provider's secret manager. Never commit the values or paste them into support
logs, screenshots, or chat.

Before deploying the app:

1. Create the platform Supabase project and obtain its project URL and
   server-only service key.
2. Apply every migration in `supabase/migrations/` **in order**, including
   `0001_platform_store.sql`, `0002_platform_hosts.sql`, and
   `0003_host_portal.sql`, `0004_tenant_owner_portal.sql`,
   `0005_tenant_store_settings.sql`, and `0006_tenant_rest_connections.sql`.
   Review each SQL file and run it in that
   project's Supabase SQL Editor or through your
   reviewed migration pipeline. Do not run migrations from the browser or
   expose the service key to the client.
3. Set the production environment variables above. Production startup requires
   `PLATFORM_STORE=supabase`, `PLATFORM_SECRET_KEY`, and `SESSION_SECRET`; the
   Supabase URL and service key are required for the Supabase adapter.
4. Deploy and complete the one-time setup at `/en/setup`. Use the real
   platform hostname as the platform domain. Save the recovery codes.
5. Remove `SETUP_TOKEN` from the production environment and redeploy/refresh
   the runtime configuration. The app does not currently rotate or remove the
   hosting provider's environment variable automatically.
6. Sign in at `/en/super-admin`, create and activate hosts, then invite Host
   Owners. Share invitation URLs manually until an email provider is configured.
7. Host Owners can create and activate tenants, invite one Tenant Owner per
   tenant, and share the generated invitation URL manually. Tenant Owners sign
   in at `/en/tenant`.

If production setup fails, check server logs for missing environment
configuration and confirm migrations completed. Do not solve setup errors by
switching production to the local file store.

## Changing the store or resetting local setup

- Moving from the file adapter to Supabase does **not** migrate records
  automatically. There is currently no migration/export/import command. Plan a
  deliberate, protected data transfer before changing stores.
- The file adapter preserves older local JSON records when host records are
  added; it defaults a missing `hosts` field to an empty list.
- Re-running `/setup` is intentionally not supported once the store is
  initialized. There is not yet a Super Admin recovery/reset CLI. Do not delete
  the platform state as a substitute for an account recovery process.
- Rotating `PLATFORM_SECRET_KEY` without re-encrypting stored secrets can make
  them undecryptable. Plan a proper key rotation/migration before changing it.

## Validation commands

```powershell
npm run typecheck
npm run lint
npm test
npm run format:check
npm run build
```

## Related project docs

- [README.md](./README.md) — quick local setup
- [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) — product scope, security and
  licensing requirements, and full roadmap
