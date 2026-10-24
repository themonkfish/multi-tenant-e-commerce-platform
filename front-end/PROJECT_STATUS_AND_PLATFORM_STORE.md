# Project Status and Platform Store Guide

This document records what is implemented, what remains on the project
roadmap, and how to configure the platform's own persistent store. It reflects
the current repository implementation; items in the project context are not
automatically implemented just because they are listed there.

## Current status

Status snapshot as of 2026-10-24:

- The frontend platform bootstrap, Super Admin onboarding, host/tenant
  lifecycle management, scoped portal auth flows, and tenant-scoped cache
  hardening are in place and working for the current app surface.
- Platform setup validation is now centralized for platform-domain and
  reserved-subdomain checks, and the setup wizard accepts a custom reserved
  subdomain list to avoid deployment misconfiguration. The wizard also checks
  platform-store/security readiness, saves platform branding/legal links, and
  provides first-Host guidance. Host and Tenant owner invitations can be sent
  through Resend, with one-time links retained as manual fallbacks.
- The file-store developer path is fully usable locally; the Supabase platform
  store is the supported production path once the required migration set is
  applied.
- REST, Supabase, and MongoDB Atlas tenant catalog adapters, owner connection
  setup, schema initialization/version checks, and authenticated tenant product
  APIs are implemented with tenant-scoped server-side checks.
- Tenant branding/locale metadata is persisted and applied to the tenant
  storefront landing preview. A browser-persisted cart now submits
  authenticated, server-validated orders. Tenant custom domains can be claimed
  with TXT ownership and platform CNAME records, then routed after verification;
  provider-neutral HTTPS/TLS readiness checks are available. Domain attachment
  at the hosting provider, registrar automation, and the full commerce runtime
  remain future work.
- Tenant catalog APIs route through configured REST, Supabase, or MongoDB Atlas
  providers; order APIs continue through the REST backend. Tenant-specific
  live card payments remain future work. Tenant Owner-managed S3-compatible
  storage configuration and tenant-scoped JPEG/PNG/WebP uploads are
  implemented; catalog writers can attach uploaded images to products and
  render them across the tenant storefront. Products now have tenant-scoped
  categories; the storefront supports active-product search, category filters,
  and paginated browsing. Products may define up to three variant option
  groups, with validated selections retained through cart, checkout, and orders.
- Tenant Owner-managed Staff catalog/order permissions and Tenant-scoped
  Customer sign-in/order reads are now server-enforced; isolated demo
  credentials and sample Customer orders support local testing.
- Authenticated checkout creates idempotent platform order snapshots from
  current catalog prices, creates Stripe test Checkout sessions, and waits for
  signed payment webhooks before syncing card orders to the Tenant backend.
  India-only INR cash-on-delivery orders require an Indian delivery address,
  are synced as unpaid orders, and can be marked collected by an authorized
  Tenant operator with an audit event. Payment retries are idempotent. Variant
  inventory is opt-in and reserved atomically at checkout; failed/expired card
  payments release reservations, while successful card and COD orders consume
  them. Live card payments and fulfillment remain unimplemented; Stripe
  Connect onboarding is blocked pending confirmation that India is eligible
  for the platform country.
- Tenant Owners can configure AWS S3 or an S3-compatible service with encrypted
  credentials. Catalog writers can upload signature-validated JPEG, PNG, and
  WebP images up to 10 MB; the server generates tenant-scoped object keys and
  proxies uploads to storage.
- Baseline security response headers are configured globally for pages and API
  routes. HSTS is enabled only in production.

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
      when resolving a tenant domain, rendering a branded preview shell and
      public catalog cards with linked product detail pages when active products
      are available from the tenant backend while the full commerce experience
      remains intentionally unavailable.
- [x] Host Owners can add tenant custom domains, receive DNS verification
      instructions, and activate exact-domain routing only after TXT ownership
      and platform CNAME records resolve.
- [x] Host Owners can check verified domains for public HTTPS reachability and
      a valid, unexpired TLS certificate without provider-specific credentials.
- [x] Tenant storefront cart: persisted cart state, add-to-cart actions, and a
      focused cart page are wired to the storefront.
- [x] Authenticated server-side order creation revalidates active catalog
      products, calculates totals on the server, persists line-item snapshots
      with idempotency, and displays Customer-scoped confirmation/history.
- [x] Customer order confirmation and account history use server-persisted
      orders, scoped to the signed-in Customer and Tenant.
- [x] Idempotent Tenant REST order ingestion persists order snapshots in
      SQLite; delivery status is recorded in the platform store and failed or
      pending sync can be retried by the owning Customer.
- [x] Tenant Owners and explicitly permissioned Staff can list, paginate,
      inspect, and advance Tenant order statuses; Customer order history is
      updated to reflect operational status changes.
- [x] Tenant Owner REST backend connection setup with HTTPS URL/version
      validation, encrypted write-only API-key storage, tenant-scoped
      persistence, and audit events.
- [x] REST health test using `X-API-Key`, private/internal DNS rejection,
      pinned public DNS address, no redirects, response-size/time limits, and
      per-account rate limiting.
- [x] Versioned REST catalog adapter for product list/read/create/update/delete
      with server-only API-key access, tenant-scoped BFF routes, contract
      validation, and mutation rate limits.
- [x] Tenant Supabase and MongoDB Atlas catalog adapters with encrypted
      write-only credentials, owner connection testing, schema initialization,
      schema-version reporting, and tenant-scoped product operations.
- [x] Server-enforced permissions for Super Admin, Host Owner, Tenant Owner,
      Tenant Staff, and Customer roles. Staff catalog/order permissions, Tenant
      boundaries, Customer-owned order reads, and owner-only Staff management
      are checked on the server.
- [x] Tenant Staff login and Tenant Owner-managed Staff accounts with catalog
      read/write permissions, disable/reactivate, and password-reset controls;
      Tenant-specific Customer registration/login and own-order views are
      available on active Tenant domains.
- [x] Demo Staff and Customer fixtures, two sample Customer orders, and
      additive seeding for existing isolated demo stores.
- [x] Supabase platform schema migrations for bootstrap, hosts, and the Host
      Owner/tenant portal, Tenant Owner accounts/invitations, and tenant
      settings, Staff, Customers, tenant-scoped Customer orders, Tenant backend
      order-sync state, data-provider configuration, and S3 storage settings.
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
- [x] **Customer storefront:** catalog browsing and cart state are in place;
      authenticated order creation, confirmation, and history are server-backed.
      Order snapshots sync to the connected Tenant backend with a visible and
      retryable delivery status; Tenant order management supports basic status
      transitions. Payments and fulfillment are still pending.
- [x] **Setup wizard:** validates platform-domain and reserved-subdomain input,
      verifies required server security configuration and platform-store
      connectivity before setup, saves platform name/theme/legal links, enrolls
      TOTP, and gives first-Host guidance. Platform-store credentials remain
      deployment configuration; email delivery intentionally remains manual.
- [ ] **Super Admin dashboard:** host creation/status management works;
      editing host details, deletion, invitations, staff/roles, settings, health,
      analytics, domains, billing, and audit-log views remain.
- [ ] **Host and tenant architecture:** basic Host Owner authentication and
      tenant metadata management and an initial Tenant Owner portal are
      implemented. Tenant-specific configuration stores, automated domain/TLS
      provisioning, tenant backends, Staff lifecycle controls, and
      expanded RBAC remain. Branding/locale settings now flow into the tenant
      domain landing preview, the catalog listing, and product detail pages when
      a backend is configured; the full customer storefront and commerce
      runtime remain future work. Resolved domain scopes
      apply to all localized pages and authenticated portal requests, and
      tenant-scoped routes explicitly opt out of shared Next.js caching to avoid
      cross-tenant reuse.
- [ ] **i18n:** routing infrastructure exists, but only English is configured.
      The tenant storefront preview uses the saved default locale metadata but
      does not yet expand the public storefront to localized customer pages.
- [ ] **Security/operations:** authentication and mutation protections exist
      for current flows. Rate limits use the configured PlatformStore and
      mutation limits are per-account; production monitoring, a shared
      distributed rate-limit service, automated migration deployment,
      and backup/restore still need work.

### Pending roadmap

#### Recommended next implementation sequence (priority-ordered)

1. **P1 — Security and scope hardening**
   - Completed: auth/session boundaries, tenant-scoped host validation, stale
     singleton removal, and tenant-aware cache invalidation for scoped routes.
   - Keep regression coverage for platform, host, tenant, staff, and customer
     scopes as the ongoing safety net.
   - Continue hardening auth/session boundaries for tenant storefront and portal
     routes as new features are introduced.

2. **P1 — Tenant provisioning and platform configuration**
   - Finish tenant storefront provisioning and the managed tenant
     settings flow.
   - Setup verification, theme/legal settings, first-host guidance, and
     Resend-backed Host/Tenant invitation emails are implemented.
     Reserved-domain validation is centralized.
   - Extend the Tenant Owner portal with storage, payment, catalog, and staff
     configuration controls.

3. **P1 — Provider data layer**
   - Implement the tenant Supabase and MongoDB adapters, reference schemas, and
     provider testing/initialization flows.
   - Add schema-version checks and upgrade prompts for tenant data providers.
   - Continue credential rotation and connection-validation workflows.

4. **P2 — Commerce backend and fulfillment**
   - Add production payment operations and Stripe Connect tenant onboarding.
     Stripe test-mode checkout and webhook verification, plus India-only
     Cash on Delivery, are implemented. Stripe Connect is blocked pending
     platform-country eligibility; regional gateways are deferred.
   - Wire uploaded assets into product image management.
   - Build customer, shipping, tax, and discount workflows around synchronized
     Tenant backend order snapshots; variant inventory reservation is implemented.

5. **P2 — Storefront runtime upgrade**
   - Add production checkout settings and payment operations; the current Stripe
     integration is restricted to test mode.
   - Completed: storefront name search, category browsing, pagination, and
     product option selection with server-validated order snapshots.
   - Per-variant pricing and SKU remain future catalog work; inventory tracking
     and checkout reservation are implemented.
   - Connect order placement to fulfillment workflows.

6. **P3 — Platform operations and scale**
   - Add observability, CI/CD, automated migration deployment, audit tooling,
     backups, and restore workflows.
   - Choose background jobs, email delivery, domain/SSL strategy, and tenant
     identity model.
   - Add compliance and export/deletion workflows for tenant data.

7. **P3 — Growth and expansion work**
   - Add CMS, reviews, reporting, staff permissions, webhooks, PWA support,
     and theming tools.
   - Expand i18n and localized storefront customer experiences beyond the
     current English-only foundation.

#### Foundation and tenancy

- [ ] Choose a separate host/tenant configuration persistence owner if these
      records need to move outside the platform store; lookup ports currently
      use the platform store as their source of truth.
- [x] Apply trusted domain scopes across localized pages and authenticated
      platform, host, and tenant requests.
- [x] Add tenant-aware cache invalidation and prevent cross-tenant cache reuse
      when tenant data is introduced into a cache.
- [x] Enforce role permissions and scopes for platform, host, tenant, Staff,
      and Customer operations on the server.
- [ ] Add Staff permission editing, account deletion, and broader
      Staff-management controls.
- [ ] Provision tenant storefronts and domains; extend the initial Tenant Owner
      portal with backend, storage, payment, catalog, and staff settings.
- [x] Complete the setup wizard's connection check, platform theme/legal
      settings, invitation-email readiness status, and first-host guidance.
      Reserved-domain configuration is implemented and centralized.
- [x] Configure Resend-backed Host/Tenant invitation delivery. Manual
      one-time invitation links remain available when email is unconfigured or
      delivery fails.
- [ ] Add automated Supabase migration and deployment checks.

#### Tenant data and integrations

- [x] Add local product-management screen for catalog CRUD. REST connection,
      health testing, catalog adapter, and authenticated product API routes are
      implemented; end-to-end mock coverage remains as a follow-up enhancement.
- [ ] Implement tenant Supabase and MongoDB data adapters, reference schemas,
      provider setup, test-connection, and schema initialization.
- [ ] Add connection testing for other providers and full credential rotation
      workflows. REST API-key replacement is supported; OAuth/JWT are not.
- [x] Add Stripe test-mode Checkout, signature verification, idempotent payment
      state updates, retryable order delivery, and Customer payment states.
- [x] Add a local-only simulated checkout for testing success, failure, and
      Tenant order delivery without payment-provider credentials.
- [ ] Add production Stripe Connect after provider-specific onboarding,
      compliance work, and confirmation of India platform eligibility.
- [ ] Add regional payment gateways after the supported regions and providers
      are selected.
- [x] Add India-only Cash on Delivery with required Indian delivery address,
      Tenant REST order delivery, authorized collection confirmation, and
      audit logging.
- [x] Implement an S3-compatible storage adapter, Owner-managed encrypted
      credentials, upload validation including file-content signatures, and
      tenant-scoped paths. Catalog writers can upload, preview, save, and remove
      product images; storefront cards and detail pages render saved images.
- [ ] Add additional storage providers based on the v1 scope.

#### Commerce experiences

- [x] Product option variants across REST, Supabase, and MongoDB catalogs,
      storefront selection, distinct cart lines, and server-validated order
      snapshots. Optional per-variant stock tracking, atomic checkout
      reservations, and payment-state transitions are implemented; per-variant
      price and SKU remain future work.
- [x] Tenant product categories and storefront name search, category filters,
      and pagination across REST, Supabase, and MongoDB catalog providers.
- [x] Product image management: tenant-scoped uploads, HTTPS image URLs saved
      through all catalog adapters, and storefront rendering. Tenant Supabase
      catalog schemas must be upgraded to version 5.
- [ ] Orders, customers, discounts, shipping, and tax workflows.
- [x] Tenant storefront preview: catalog and cart are implemented; authenticated
      checkout creates server-side order records and shows Customer-scoped order
      confirmation/history.
- [x] Tenant-specific Customer authentication and own-order read access;
      order totals are calculated from active Tenant catalog prices.
- [ ] Full tenant commerce runtime: add live payment processing, shipping/tax
      handling, and production checkout orchestration.
- [ ] Host and Super Admin domain management, plans/limits, health, audit,
      analytics, and platform settings.
- [ ] Later growth work: CMS, reviews, reporting, staff permissions, webhooks,
      PWA, and theming tools.

#### Production decisions and hardening

- [ ] Choose background jobs, email delivery, custom-domain/SSL strategy,
      tenant-aware caching, and customer identity model.
- [x] Define inventory reservation and payment-failure behavior. Reservations
      occur at checkout; failed/expired card payments release them, and COD
      orders consume stock when placed.
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
| `RESEND_API_KEY`                | Optional for invitation email                        | Server-only API key used to deliver Host/Tenant invitations through Resend.                                                                                 |
| `INVITATION_EMAIL_FROM`         | With `RESEND_API_KEY`                                | Verified sender address/name, such as `Platform <noreply@example.com>`. Leave both values blank for manual invitation links.                                |
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
6. Optional: configure `RESEND_API_KEY` and `INVITATION_EMAIL_FROM` to deliver
   invitations through Resend. Without both values, the app provides a
   one-time link for manual sharing.
7. Sign in at `http://localhost:3000/en/super-admin`, create a host, and
   activate it.
8. Invite its owner; the invitation is emailed when configured, and the
   one-time URL remains available as a fallback. Open the link, set a password
   of at least 14 characters,
   then use `http://localhost:3000/en/host` to manage tenants.
9. Activate a tenant and invite its owner from that tenant's row. The owner
   sets a password of at least 14
   characters and signs in at `http://localhost:3000/en/tenant`.
10. Tenant Owners can save the store display name, description, HTTPS logo URL,
    brand colors, locales, and currencies from Brand and localization.
11. In Store setup, configure the REST backend's HTTPS base URL, API version
    (for example `v1`), and API key. Save, then use **Test saved connection**.
    The tenant backend must expose `GET /{apiVersion}/health` and return JSON
    with a non-empty `status` plus `db` and `storage` set to `up` or `down`.
    Authentication is sent as `X-API-Key`. Leave API key blank to retain it;
    entering a new value rotates it. The value is write-only.
    Alternatively, configure a dedicated tenant Supabase project or MongoDB
    Atlas database. Supabase requires applying
    [`supabase/reference/tenant-catalog.sql`](./supabase/reference/tenant-catalog.sql)
    in the tenant project before testing and initialization; MongoDB Atlas
    collections and indexes are initialized by the app. Database providers
    take precedence over REST for catalog operations. The supported database
    schema is version 5; test results report incompatible versions, and the
    app will not initialize a database with a newer version.
    MongoDB initializes a `tenant_products` collection with a strict product
    document validator, tenant-scoped slug and creation-time indexes, and a
    tenant-bound `tenant_schema_metadata` version record. Products support
    optional categories, option variants, and variant stock; database-backed
    search matches product titles. MongoDB inventory operations require
    transaction-capable deployment support.
    Only dedicated
    Supabase projects and dedicated MongoDB databases are currently supported;
    shared-database tenancy modes are not enabled for these direct credentials.
12. A Tenant Owner session can also exercise the catalog API:
    `GET /api/tenant/products?page=1&limit=20`,
    `POST /api/tenant/products`, and
    `GET`/`PATCH`/`DELETE /api/tenant/products/{productId}`. These routes
    proxy product operations to the connected backend. The Tenant catalog UI
    supports product CRUD, categories, image uploads, option groups (up to 3
    options, 20 values each), and optional per-variant stock entries. Track
    stock by entering every option combination in the stock editor; leave it
    blank to disable stock tracking for that product.
    REST backends must accept and return the optional `options` array of
    `{ "name": "Size", "values": ["S", "M"] }` product entries, apply
    `search`, `category`, and `status` filters to `GET /{apiVersion}/products`,
    and implement
    `GET /{apiVersion}/products/categories?tenantId=...&status=active` with a
    `{ "data": ["Category"] }` response for category browsing. Backends must
    also implement atomic inventory reservations:
    `POST /{apiVersion}/products/inventory/reservations` accepts
    `{ "tenantId": "...", "reservationId": "...", "items": [{ "productId": "...", "selections": { "Size": "M" }, "quantity": 1 }] }`
    and returns `{ "reserved": true|false }`. A reservation ID must be
    idempotent and tenant-scoped; insufficient stock must reserve nothing.
    `POST /{apiVersion}/products/inventory/reservations/{reservationId}/release`
    and `/commit` must perform idempotent state transitions and reject
    cross-tenant requests. Release restores reserved quantities; commit
    consumes them.

Tenant Supabase catalog projects use schema version 5 for product images,
categories, product option variants, and inventory reservations. Apply the current
`supabase/reference/tenant-catalog.sql` to an
existing Supabase tenant project, then use the Tenant Owner database setup to
initialize the schema. MongoDB Atlas catalogs update their product validator
and advance to version 5 through the same initialize-schema action.

The tenant portal saves branding and locale metadata but does not yet apply it
to a live storefront. REST catalog requests use the saved connection, but
tenant creation does not provision databases or TLS certificates. Tenant custom
domains can be added in the Host portal; add the displayed CNAME pointing to the
platform domain and the TXT ownership record, then select **Verify DNS**. Only
verified domains route to that tenant. Add the hostname to the hosting provider
and configure it to serve this app; then use **Check HTTPS and TLS** to verify
public HTTPS reachability and certificate validity. This check pins a public DNS
address, rejects private/internal answers, does not follow redirects, and is
rate-limited. Provider attachment and certificate issuance remain manual.
Health tests and catalog requests reject private/internal DNS
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
# Optional; both are required for automated invitations via Resend.
RESEND_API_KEY=<server-only-resend-api-key>
INVITATION_EMAIL_FROM=Platform <noreply@example.com>
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
   `0005_tenant_store_settings.sql`, `0006_tenant_rest_connections.sql`, and
   all later migrations, including `0012_tenant_domain_verification.sql`,
   `0013_platform_setup_settings.sql`, and
   `0014_tenant_database_providers.sql`, `0015_cash_on_delivery.sql`, and
   `0016_tenant_storage_providers.sql`.
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
   Owners. Invitations are emailed if Resend is configured; otherwise, share
   the one-time invitation links manually.
7. Host Owners can create and activate tenants, invite one Tenant Owner per
   tenant. Tenant Owners sign in at `/en/tenant`.

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
