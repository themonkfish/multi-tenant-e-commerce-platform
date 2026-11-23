# Project Status and Platform Store Guide

This document records what is implemented, what remains on the project
roadmap, and how to configure the platform's own persistent store. It reflects
the current repository implementation; items in the project context are not
automatically implemented just because they are listed there.

## Current status

Status snapshot as of 2026-11-23:

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
  providers; order APIs continue through the REST backend. Platform-level live
  Stripe keys are supported in production, while tenant-specific Stripe Connect
  remains future work. Tenant Owner-managed S3-compatible
  storage configuration and tenant-scoped JPEG/PNG/WebP uploads are
  implemented; catalog writers can attach uploaded images to products and
  render them across the tenant storefront. Products now have tenant-scoped
  categories; the storefront supports active-product search, category filters,
  and paginated browsing. Products may define up to three variant option
  groups, with validated selections retained through cart, checkout, and orders.
  Variants may override the base price and SKU; server-verified selections and
  resolved values are recorded in order snapshots.
- Tenant Owner-managed Staff catalog/order permissions and Tenant-scoped
  Customer sign-in/order reads are now server-enforced; isolated demo
  credentials and sample Customer orders support local testing.
- Authenticated checkout creates idempotent platform order snapshots from
  current catalog prices, creates Stripe test Checkout sessions, and waits for
  signed payment webhooks before syncing card orders to the Tenant backend.
  India-only INR cash-on-delivery orders require an Indian delivery address,
  are synced as unpaid orders, and can be marked collected by an authorized
  Tenant operator with an audit event. Customers and Tenant operators can
  cancel unpaid COD orders before processing; cancellation synchronizes the
  Tenant order, restores tracked inventory, releases discount redemptions, and
  can be retried after partial failure. Paid Stripe orders remain
  non-cancellable until refunds are implemented. Checkout now requires a validated
  India delivery address for all payments, calculates tenant-configured flat
  shipping fees and free-shipping thresholds from server-verified item prices,
  and snapshots subtotal, shipping, and total. Tenant Owners can configure
  percentage and fixed-amount discount codes with optional minimum subtotals,
  expiry dates, and redemption limits; one code applies to the merchandise
  subtotal before shipping. Discount amounts and minimum subtotals use minor
  currency units, and fixed discounts/minimums require the store's default
  currency. Tenant-configured tax is added to prices after discounts and before
  shipping, with the rate and amount stored in the order snapshot. Payment
  retries are idempotent. Variant inventory is opt-in and reserved atomically
  at checkout; failed/expired card payments release reservations, while
  successful card and COD orders consume them. Basic fulfillment tracking is
  supported when Tenant operators ship an order, including a manual
  **Delivered** confirmation after shipment. Customer sign-in/registration,
  cart and checkout form, order confirmation, demo payment screens, account
  history, tenant landing page, product detail and review UI, catalog browsing,
  order-sync messages, and order progress are localized in English, French, and
  Hindi; cancellation has a distinct terminal state. Live carrier integrations
  and live card payments remain future work.
  Stripe Connect onboarding is blocked pending confirmation that India is
  eligible for the platform country.
- Tenant Owners can configure AWS S3 or an S3-compatible service with encrypted
  credentials. Catalog writers can upload signature-validated JPEG, PNG, and
  WebP images up to 10 MB; the server generates tenant-scoped object keys and
  proxies uploads to storage.
- Tenant Owners can also configure Supabase Storage with an encrypted service
  key. Supabase and S3 adapters share the tenant-scoped key and health-check
  contract.
- Baseline security response headers are configured globally for pages and API
  routes. HSTS is enabled only in production.
- The file platform store has checksummed timestamped backup and guarded restore
  scripts. Restore requires `--force`, leaves a pre-restore copy, and rejects
  checksum or format mismatches.
- Platform-store backup rotation retains a configurable newest backup count
  and removes older timestamped backup files without touching restore copies.
- Tenant Owners can export tenant metadata, settings, staff, connection
  metadata, orders, and scoped audit events as secret-free JSON. Export requests
  are origin-checked, rate-limited, and audited.
- The Tenant portal exposes a one-click JSON data export download for authorized
  Tenant Owners.
- Application CI now validates linting, TypeScript, frontend tests, tenant
  backend tests, Playwright flows, Supabase migrations, dependencies, and
  application SBOM generation. A public health route reports platform-store
  availability and setup state.
- Supabase migration CI resets a clean local database, applies every migration
  in repository order, and lints the resulting schema.
- CI generates a sorted dependency-notices JSON manifest from the frontend
  package lock and uploads it alongside the SBOM and dependency audit artifacts.
- The tenant reference SQLite backend reports schema version 9, supporting
  catalog schema version 7 fields for categories, images, options, inventory
  variants, and variant pricing, plus idempotent reservation restoration,
  cancellation, and manual delivery status.
- Playwright readiness waits now allow up to five minutes for slow Next.js
  startup and the E2E local backend/fixture server.
- Public health responses now include UTC timestamps and request correlation
  IDs, and emit structured JSON logs for healthy or degraded platform-store
  outcomes.
- Product reviews require an authenticated Customer with a paid tenant order
  containing the reviewed product; review eligibility uses server-side order
  snapshots, and review reads/submissions reject missing or inactive products.
- English, French, and Hindi locale routing is available, with a locale
  switcher and regression coverage. Tenant storefront copy and broader customer
  experiences may still be expanded through tenant locale settings.
- Locale switching is now consistently rendered inside the active
  `next-intl` client provider, allowing localized pages and footers to start
  without missing-intl-context errors.
- Checkout idempotency replays now compare persisted cart unit prices and
  expected client prices, preventing a reused order key from accepting stale
  or changed checkout pricing.
- Fully refunded Stripe orders reconcile inventory, discount commitments, the
  Tenant backend snapshot, platform order status, and audit events. Refund
  replay remains safe after partial cleanup.
- Customer order sync retries now cover paid card orders and accepted
  cash-on-delivery orders. Pending or otherwise unconfirmed payments remain
  blocked from Tenant delivery.
- Order status reconciliation is monotonic across Tenant routes and platform
  stores: retries are idempotent, backward transitions are rejected, and
  cancelled/delivered terminal states cannot regress.
- Carrier webhook reconciliation rejects tracking-number mismatches and
  Delivered events that arrive before an order is shipped. Monotonic
  Processing/Shipped/Delivered transitions, replay handling, and signature
  rejection remain covered by focused route tests.
- P1 scope-hardening regression coverage now rejects mismatched domains,
  suspended hosts and tenants, removed tenant owners and customers, and disabled
  tenant staff in live session revalidation tests.
- The Tenant Owner dashboard includes a localized provisioning-readiness
  summary for catalog, payment, storage, staff, and custom-domain setup.
- Tenant database-provider route coverage now includes credential replacement,
  provider switching, missing credentials, stale-secret cleanup, cleanup
  failures, connection testing, schema initialization, upgrade confirmation,
  and provider removal.

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
- [x] Super Admin host editing: update host name, slug, plan, limits, domains,
      support contact, branding name, and audit the change.
- [x] Super Admin host deletion: empty hosts can be deleted with confirmation;
      hosts with tenants are rejected without deleting any records.
- [x] Super Admin platform settings: platform name, theme colors, terms URL,
      and privacy URL can be viewed and updated with validation and audit events.
- [x] Super Admin global health: setup/store status and active versus total
      host and tenant counts are shown beside the public health endpoint link.
- [x] Super Admin analytics: persisted order count, paid and COD-due counts,
      and gross order totals grouped by currency are shown across tenant scopes.
- [x] Super Admin domain inventory: platform, host, verified tenant, and pending
      tenant domain claims are shown with scope and status.
- [x] Super Admin plan and usage view: host plans, tenant counts, custom-domain
      usage, configured limits, and account status are shown. Live invoicing and
      billing-provider integration remain future work.
- [x] Host tenant deletion: Host Owners can permanently delete a tenant and
      its platform-owned staff, customers, orders, settings, connections,
      domains, invites, discounts, and secrets. External provider data requires
      separate purge procedures.
- [x] Host tenant metadata editing: Host Owners can update tenant names and
      plans through the host-scoped portal, with validation and audit events.
- [x] Super Admin role matrix: effective platform, host, tenant, staff, and
      customer permissions are visible in the dashboard. Host Staff accounts
      and broader Super Admin staff-account management remain future work.
- [x] Super Admin audit-log view: the platform dashboard lists recent
      platform-scoped audit events and exports up to 1,000 events as JSON.
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
- [x] Host Owners can cancel pending tenant-domain claims before verification.
      Cancellation removes the claim, frees custom-domain usage, and records an
      audited host-scoped event.
- [x] Host Owners can check verified domains for public HTTPS reachability and
      a valid, unexpired TLS certificate without provider-specific credentials.
- [x] Custom-domain/SSL strategy: exact-domain ownership uses TXT/CNAME
      verification and provider-neutral public HTTPS/TLS readiness checks; hosting
      attachment and certificate issuance remain the registrar/provider's
      responsibility.
- [x] Tenant storefront cart: persisted cart state, add-to-cart actions, and a
      focused cart page are wired to the storefront.
- [x] Authenticated server-side order creation revalidates active catalog
      products, calculates totals on the server, persists line-item snapshots
      with idempotency, and displays Customer-scoped confirmation/history.
- [x] Customer order confirmation and account history use server-persisted
      orders, scoped to the signed-in Customer and Tenant, with an accessible
      English/French/Hindi sign-in and registration flow, account interface,
      and order-progress timeline through delivery with a separate cancelled
      state.
- [x] The Customer cart and checkout form are localized in English, French,
      and Hindi, including discount handling, payment methods, delivery fields,
      checkout feedback, and add-to-cart controls.
- [x] Order confirmation and local demo-payment screens are localized in
      English, French, and Hindi, including payment outcomes, order details,
      and totals.
- [x] Product detail navigation and the Customer review form are localized in
      English, French, and Hindi, including review eligibility and submission
      feedback.
- [x] The Customer product catalog is localized in English, French, and Hindi,
      including search, category filters, result counts, empty states, and
      pagination.
- [x] Tenant storefront landing copy is localized in English, French, and
      Hindi, including store metadata, featured catalog content, and navigation.
- [x] Tenant Owners can configure a flat shipping fee and optional
      free-shipping threshold in the store's default currency. Checkout
      validates India delivery details for card and COD orders and calculates
      the final shipping amount from current catalog prices on the server.
- [x] Tenant Owners can configure percentage and fixed-amount discount codes
      with optional minimum subtotals, expiry timestamps, and redemption caps.
      Checkout validates discounts against server-priced merchandise,
      reserves capped redemptions through payment, and snapshots the code,
      discount, subtotal, shipping, and final total.
- [x] Tenant Owners can configure a tax-exclusive percentage rate (0–100%,
      up to two decimal places). Checkout calculates tax on merchandise after
      discounts and before shipping using server-priced order amounts, stores
      the rate and rounded tax amount in order snapshots, and includes tax in
      Stripe and COD totals. This basic rate setting is not jurisdiction-aware
      tax advice or automated tax compliance.
- [x] Idempotent Tenant REST order ingestion persists order snapshots in
      SQLite; delivery status is recorded in the platform store and failed or
      pending sync can be retried by the owning Customer. The backend order
      contract accepts and persists `subtotal`, `discountCode`,
      `discountAmount`, `taxRateBasisPoints`, `taxAmount`, `shippingAmount`,
      and the validated `deliveryAddress` provided in
      `POST /{apiVersion}/orders`. Order line items include the server-resolved
      variant SKU and unit price.
- [x] Tenant Owners and explicitly permissioned Staff can list, paginate,
      inspect, and advance Tenant order statuses; Customer order history is
      updated to reflect operational status changes. Shipment tracking numbers,
      optional carrier names, and HTTPS tracking links are stored in platform
      order snapshots and shown in Tenant management and Customer history.
      Shipped orders can be manually marked Delivered; delivery is a terminal
      status and does not trigger a carrier or payment action.
      Connected REST backends should persist and return the optional
      `fulfillment` object when
      `PATCH /{apiVersion}/orders/{orderId}` changes status to `Shipped`, and
      accept `Delivered` only after `Shipped`.
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
      and order permissions, permission editing, disable/reactivate,
      password-reset, and deletion controls; Tenant-specific Customer
      registration/login and own-order views are available on active domains.
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
      transitions and optional shipment tracking details. Live payments and
      carrier integrations are still pending.
- [x] **Setup wizard:** validates platform-domain and reserved-subdomain input,
      verifies required server security configuration and platform-store
      connectivity before setup, saves platform name/theme/legal links, enrolls
      TOTP, and gives first-Host guidance. Platform-store credentials remain
      deployment configuration; email delivery intentionally remains manual.
- [ ] **Super Admin dashboard:** host creation/status management works;
      editing host details works for name, slug, plan, limits, domains, and
      support contact; a recent platform audit log and JSON export are available.
      Empty hosts can be deleted with confirmation; hosts with tenants are
      protected. Platform branding, legal links, role permissions, and live
      billing usage are visible. Live billing remains future work. Basic
      persisted order analytics,
      platform/host/tenant/pending-domain inventory, and plan/limit usage are
      available.
- [ ] **Host and tenant architecture:** basic Host Owner authentication and
      tenant metadata management and an initial Tenant Owner portal are
      implemented. Tenant-specific configuration stores, automated domain/TLS
      provisioning, tenant backends, and expanded RBAC remain. Staff account
      permission editing, disabling, password reset, and deletion are
      implemented. Branding/locale settings now flow into the tenant
      domain landing preview, the catalog listing, and product detail pages when
      a backend is configured; the full customer storefront and commerce
      runtime remain future work. Resolved domain scopes
      apply to all localized pages and authenticated portal requests, and
      tenant-scoped routes explicitly opt out of shared Next.js caching to avoid
      cross-tenant reuse.
- [x] **i18n:** English, French, and Hindi routing is configured with a locale
      switcher and 303 frontend tests. Customer sign-in/registration, cart and
      checkout form, order confirmation and demo payment screens, account,
      tenant storefront landing page, product detail and review UI, catalog
      browsing, order-sync messages, order progress, and Tenant Owner sign-in
      are localized in all three languages. The Tenant Owner brand/localization
      section, store settings form, and Staff account management are also
      localized, and the Tenant Staff sign-in flow is localized for Email,
      password, status, and error handling. Tenant REST backend connection setup
      and Supabase/MongoDB database-provider setup are localized across save,
      test, initialization, removal, security, and health-check states. S3
      compatible storage setup is localized across configuration, credentials,
      testing, and removal. Tenant dashboard navigation, catalog and order
      manager links, future-work notice, assigned domains, and secret-free data
      export are localized. Tenant catalog management, product forms, variant
      inventory/pricing, image upload controls, status labels, and CRUD feedback
      are localized. Tenant order management, COD collection/cancellation,
      shipment tracking, status updates, order details, and pagination are
      localized. Tenant invitation acceptance is localized across password
      entry and invalid/expired invite states. Host Owner sign-in, invitation
      acceptance, portal header, sign-out, and invitation-error states are
      localized. Super Admin sign-in and dashboard shell are localized.
      Super Admin host management is localized across creation, editing,
      activation, suspension, invitations, deletion, limits, and errors. Host
      tenant management is localized across creation, activation, suspension,
      invitations, custom-domain verification/readiness, deletion, limits, and
      errors. Super Admin platform settings, health, analytics, audit log, and
      domain inventory panels are localized. Super Admin billing/usage and role
      permission matrix panels are localized. The platform setup/bootstrap wizard
      is localized across readiness, theme/legal settings, TOTP enrollment,
      recovery codes, and setup errors. Remaining Host custom-domain DNS labels
      are localized, with protocol terms retained where standard.
      Catalog checks cover missing keys and interpolation variables.
      Tenant-authored product and branding content remains as supplied.
- [ ] **Security/operations:** authentication and mutation protections exist
      for current flows. Rate limits use the configured PlatformStore and
      mutation limits are per-account. Structured logging and request
      correlation, audit export, file-store backup/restore, dependency audit,
      SBOM generation, and health reporting are implemented. Production
      in-process webhook/provider counters and uptime are exposed by health;
      bearer-protected Prometheus-text metrics are available at `/api/metrics`.
      External monitoring dashboards, alerting, a shared distributed rate-limit
      service, automated migration deployment, restore automation, and full
      compliance tooling remain.

### Pending roadmap

#### Recommended next implementation sequence (priority-ordered)

1. **P1 — Security and scope hardening**
   - Completed: auth/session boundaries, tenant-scoped host validation, stale
     singleton removal, and tenant-aware cache invalidation for scoped routes.
     Tenant Staff JWTs are revalidated against the live account and reject
     disabled staff immediately, even if the JWT has not expired.
   - Keep regression coverage for platform, host, tenant, staff, and customer
     scopes as the ongoing safety net.
   - Continue hardening auth/session boundaries for tenant storefront and portal
     routes as new features are introduced.

2. **P1 — Tenant provisioning and platform configuration**
   - Tenant storefront branding, settings, catalog, storage, staff, payment,
     and domain workflows are implemented.
   - Setup verification, theme/legal settings, first-host guidance, and
     Resend-backed Host/Tenant invitation emails are implemented.
     Reserved-domain validation is centralized.
   - The Tenant Owner dashboard includes a localized provisioning-readiness
     summary for catalog, payment, storage, staff, and custom-domain setup.
   - Storage, payment, catalog, and staff configuration controls are available;
     provisioning readiness is shown in the Tenant Owner portal.

3. **P1 — Provider data layer**
   - Completed: tenant Supabase and MongoDB adapters, reference schemas, and
     provider testing/initialization flows.
   - Older tenant database schemas now require an explicit upgrade confirmation;
     newer schemas are rejected with a platform upgrade-required response.
   - Schema-version checks and upgrade prompts are implemented for tenant data
     providers, with credential replacement and connection-validation workflows.
     Provider save, provider-switch, stale-secret cleanup, test, initialization,
     upgrade, and removal routes have route-level regression coverage.

4. **P2 — Commerce backend and fulfillment**
   - Added Stripe test/live key support and mode-matched signed webhook
     verification, plus India-only Cash on Delivery. Stripe Connect tenant
     onboarding is blocked pending platform-country eligibility; regional
     gateways are deferred.
   - Uploaded S3-compatible tenant assets can be selected for product images;
     server-side catalog mutations validate uploaded image ownership and
     replaced or deleted product images are cleaned up when storage permits.
   - Basic address capture, configurable flat shipping, and order tracking are
     implemented. Discount codes and variant inventory reservation are
     implemented; continue with tax workflows around synchronized Tenant
     backend order snapshots.

5. **P2 — Storefront runtime upgrade**
   - Added production Stripe key support and mode-matched webhook checks.
   - Completed: storefront name search, category browsing, pagination, and
     product option selection with server-validated order snapshots.
   - Per-variant pricing and SKU overrides are implemented; inventory tracking
     and checkout reservation are implemented.
   - Extend basic fulfillment tracking with carrier integrations.

6. **P3 — Platform operations and scale**
   - CI, migration validation, dependency audit, SBOM generation, health
     reporting, structured logging, audit export, file-store backup/restore,
     and application test automation are implemented. In-process uptime and
     webhook/provider counters are exposed through health and structured
     webhook logs. Add external monitoring dashboards/alerting, automated
     production migration deployment, backup rotation, and restore automation.
   - Choose background jobs, email delivery, domain/SSL strategy, and tenant
     identity model.
   - Completed: tenant data export, Customer self-service account deletion,
     tenant/host deletion, audit-event coverage, and secret-free export
     boundaries. External provider data and registrar/carrier purge procedures
     remain separate operational workflows.

7. **P3 — Growth and expansion work**
   - Add CMS, reviews, reporting, expanded staff roles, webhooks, and theming
     tools.
   - PWA shell support is implemented with a web manifest, 192/512 icons,
     service-worker registration, and no API or cross-tenant HTML caching.
   - Expand i18n and localized storefront customer experiences beyond the
     configured English, French, and Hindi foundation.

#### Foundation and tenancy

- [x] Configuration ownership: `PlatformStore` remains the source of truth for
      hosts, tenants, plans, limits, domains, settings, users, audit events,
      and secret references. Runtime domain lookup continues to validate host
      and tenant scope. Tenant external backends/storage/payment providers remain
      separate infrastructure with secret references stored in the platform
      store. Host or provider moves require a reviewed backup/migration/cutover
      procedure and are not implicit runtime switches.
- [x] Apply trusted domain scopes across localized pages and authenticated
      platform, host, and tenant requests.
- [x] Add tenant-aware cache invalidation and prevent cross-tenant cache reuse
      when tenant data is introduced into a cache.
- [x] Enforce role permissions and scopes for platform, host, tenant, Staff,
      and Customer operations on the server.
- [x] Add Tenant Owner Staff permission editing and account deletion with
      tenant-scoped operations and audit events.
- [x] Provision tenant storefront domains: add, DNS/TXT verify, HTTPS/TLS
      readiness-check, and remove verified custom domains. Tenant Owner backend,
      storage, payment, catalog, and staff settings are also available.
- [x] Complete the setup wizard's connection check, platform theme/legal
      settings, invitation-email readiness status, and first-host guidance.
      Reserved-domain configuration is implemented and centralized.
- [x] Configure Resend-backed Host/Tenant invitation delivery. Manual
      one-time invitation links remain available when email is unconfigured or
      delivery fails.
- [x] Add CI validation that applies all platform Supabase migrations to a
      clean local database and lints the resulting schema. Production migration
      deployment remains a reviewed manual operation.

#### Tenant data and integrations

- [x] Add local product-management screen for catalog CRUD. REST connection,
      health testing, catalog adapter, and authenticated product API routes are
      implemented. Playwright covers tenant-scoped product create, edit, API
      verification, delete, and isolation against a local mock backend. The
      reference SQLite backend reports schema version 9 and supports catalog
      schema version 7 fields, idempotent reservation restoration, and
      Delivered order status.
- [x] Implement tenant Supabase and MongoDB data adapters, reference schemas,
      provider setup, test-connection, and schema initialization. Older and newer
      schema versions are classified for upgrade or compatibility handling.
- [x] Credential replacement workflows cover REST API keys, Supabase and MongoDB
      database secrets, and S3-compatible storage credentials. Partial credential
      pairs are rejected and write-only secrets are cleaned up after successful
      replacement. S3 storage connection testing is covered through its bucket
      health route. Additional provider connection-testing implementations remain.
      Supabase/MongoDB database test and schema-initialize routes now have
      route-level coverage for healthy/unhealthy results, upgrade-required
      initialization, and rate limits.
- [x] Add Stripe test-mode Checkout, signature verification, idempotent payment
      state updates, retryable order delivery, and Customer payment states.
      Checkout tests verify the separate shipping line item, zero-shipping
      behavior, and consistency with the saved order total. Stripe webhook
      replay avoids duplicate paid-payment writes and returns a retryable 503
      while Tenant order delivery remains pending. Replay also avoids duplicate
      inventory and discount commits after a payment is already paid.
      Fully refunded Stripe charges reconcile to a `refunded` Customer payment
      state; partial refunds do not prematurely mark the order refunded.
      Authorized Tenant operators can request a full Stripe refund. The signed
      refund webhook restores tracked inventory, releases discount commitments,
      cancels the Tenant order snapshot, and records an audit event.
- [x] Add a local-only simulated checkout for testing success, failure, and
      Tenant order delivery without payment-provider credentials.
- [ ] Add production Stripe Connect after provider-specific onboarding,
      compliance work, and confirmation of India platform eligibility.
- [ ] Add regional payment gateways after the supported regions and providers
      are selected.
- [x] Add India-only Cash on Delivery with required Indian delivery address,
      Tenant REST order delivery, authorized collection confirmation, and
      audit logging.
- [x] Allow Customers and Tenant operators to cancel unpaid COD orders before
      processing. The platform records cancellation before synchronizing the
      Tenant backend, restoring tracked inventory, and releasing discount
      redemptions; cleanup can be retried after partial failure. Paid Stripe
      orders remain non-cancellable until refund API and webhook reconciliation
      are implemented. The Customer cancellation route has regression coverage
      for paid rejection and COD success. Tenant order
      routes have regression coverage for write permissions and COD cleanup
      handoff.
- [x] Let authorized Tenant operators manually mark Shipped orders Delivered.
      Delivered is terminal, is reflected in Customer order history, and does
      not imply carrier confirmation. The Tenant order API rejects Delivered
      transitions until the platform order is Shipped and permits idempotent
      retry when already Delivered.
- [x] Carrier tracking links: Tenant shipment details support FedEx, UPS, DHL,
      USPS, Delhivery, and BlueDart HTTPS tracking-link generation. Custom
      carriers retain an operator-entered HTTPS tracking URL. A signed generic
      carrier webhook now normalizes in-transit, out-for-delivery, and delivered
      events, rejects invalid signatures and transitions, and provides idempotent
      repeat-event handling. Carrier events are reconciled monotonically so
      older Processing events cannot regress an already Shipped or Delivered order.
      Tracking-number mismatches and premature Delivered events are rejected.
- [x] Show Customers an accessible order-progress timeline from confirmation
      through delivery in English, French, and Hindi; cancelled orders are
      displayed as a separately localized terminal state.
- [x] Implement an S3-compatible storage adapter, Owner-managed encrypted
      credentials, upload validation including file-content signatures, and
      tenant-scoped paths. Catalog writers can upload, preview, save, and remove
      product images; storefront cards and detail pages render saved images.
- [ ] Add additional storage providers based on the v1 scope.
      Supabase Storage is implemented alongside S3-compatible storage. GCS,
      Azure, Cloudinary, OAuth-backed providers, and custom storage remain future work.

#### Commerce experiences

- [x] Product option variants across REST, Supabase, and MongoDB catalogs,
      storefront selection, distinct cart lines, and server-validated order
      snapshots. Optional per-variant stock tracking, atomic checkout
      reservations, payment-state transitions, and per-variant price and SKU
      overrides are implemented.
- [x] Tenant product categories and storefront name search, category filters,
      and pagination across REST, Supabase, and MongoDB catalog providers.
- [x] Product image management: tenant-scoped uploads, HTTPS image URLs saved
      through all catalog adapters, and storefront rendering. Tenant Supabase
      catalog schemas must be upgraded to version 7.
- [x] Tenant discount codes with server-side price validation, single-code
      checkout, fixed/percentage calculation, pre-shipping application, and
      reserved/committed redemption limits.
- [x] Tenant-configured tax-exclusive percentage rates with server-side tax
      calculation on discounted merchandise, order snapshots, payment totals,
      and customer/Tenant order summaries. Checkout route coverage also verifies
      COD tax, shipping, and final-total snapshots. Optional country/state
      jurisdiction overrides are resolved before snapshotting the effective rate;
      the existing tenant-wide percentage remains the fallback and this is not
      tax-compliance or advisory automation.
- [ ] Complete orders, customer, shipping, and tax workflows.
- [x] Tenant storefront preview: catalog and cart are implemented; authenticated
      checkout creates server-side order records and shows Customer-scoped order
      confirmation/history.
- [x] Tenant-specific Customer authentication and own-order read access;
      order totals are calculated from active Tenant catalog prices.
- [ ] Full tenant commerce runtime: add live payment processing, shipping/tax
      handling, and production checkout orchestration.
- [ ] Host and Super Admin domain management, plans/limits, health, audit,
      analytics, and platform settings.
- [ ] Later growth work: CMS, broader reporting, expanded staff roles, webhooks,
      offline commerce behavior, and theming tools.
- [x] Tenant order reporting: the Tenant Owner portal shows tenant-scoped order
      volume, gross sales excluding cancelled orders, paid and COD due counts,
      refund/cancellation counts, and shipped/delivered fulfillment counts.
- [x] Product reviews: authenticated Customers with a paid tenant order
      containing the product can submit one tenant-scoped review per product;
      missing or inactive products are rejected, and active storefront product
      pages show public reviews. Duplicate submissions return a conflict, and
      Customer account deletion removes that Customer’s reviews.

#### Production decisions and hardening

- [ ] Choose background jobs, email delivery, custom-domain/SSL strategy,
      tenant-aware caching, and customer identity model.
- [x] Define inventory reservation and payment-failure behavior. Reservations
      occur at checkout; failed/expired card payments release them, and COD
      orders consume stock when placed.
- [x] Add external observability dashboards/alerts: Prometheus scrape rules,
      Grafana dashboard, Stripe/carrier failure alerts, signature-rejection
      alerts, and runbooks are included. CI/CD, dependency/license scanning,
      third-party notices, backups, tenant export/deletion, and compliance
      workflows.
      Tenant JSON export and Host-owned platform-record purging are implemented;
      external provider data requires separate purge procedures.
- [x] Customer self-service account deletion: authenticated Customers can
      delete their platform account and Customer-owned order history; external
      provider or carrier records require separate deletion workflows.
- [ ] Tenant host/provider migration tooling: the policy requires reviewed
      backup/export, validation, cutover, rollback, and regional approval.
      Secret-free file-store export, checksum verification, and scope
      preflight are implemented; automated file-to-Supabase import, credential
      re-encryption, cutover, and rollback tooling remain future work.

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
| `CARRIER_WEBHOOK_SECRET`        | Optional for live carrier events                     | HMAC-SHA256 signing secret for `POST /api/webhooks/carrier`; use `sha256=<hex>` or raw hex in `x-carrier-signature`.                                        |
| `OBSERVABILITY_METRICS_TOKEN`   | Optional for metrics scraping                        | Bearer token required to access `GET /api/metrics` Prometheus-text output.                                                                                  |
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
    schema is version 7; test results report incompatible versions, and the
    app will not initialize a database with a newer version.
    MongoDB initializes a `tenant_products` collection with a strict product
    document validator, tenant-scoped slug and creation-time indexes, and a
    tenant-bound `tenant_schema_metadata` version record. Products support
    optional categories, option variants, variant-specific prices and SKUs,
    and variant stock; database-backed
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
    options, 20 values each), per-combination price/SKU overrides, and optional
    per-variant stock entries. Track stock by entering every option combination
    in the stock editor; leave it blank to disable stock tracking for that
    product.
    REST backends must accept and return the optional `options` array of
    `{ "name": "Size", "values": ["S", "M"] }` product entries and optional
    `variantPricing` entries such as
    `{ "selections": { "Size": "M" }, "amount": 2199, "sku": "BAG-M" }`;
    omitted amount/SKU values inherit the product defaults. Checkout resolves
    prices and SKUs from the backend rather than trusting cart values. Apply
    `supabase/reference/tenant-catalog.sql` to add the `variant_pricing` column
    before initializing an existing tenant Supabase catalog. Backends must apply
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
    consumes them. To support COD cancellation, REST backends must also accept
    `PATCH /{apiVersion}/orders/{orderId}` with
    `{ "status": "Cancelled" }` for a confirmed COD order and implement
    idempotent committed-stock restoration through
    `POST /{apiVersion}/products/inventory/reservations/{reservationId}/restore`.
    COD reservation IDs use `{orderId}-cod`. For manual delivery confirmation,
    accept `PATCH /{apiVersion}/orders/{orderId}` with
    `{ "status": "Delivered" }` only when the current status is `Shipped`;
    `Delivered` must be terminal and repeat updates idempotently.

Tenant Supabase catalog projects use schema version 7 for product images,
categories, product option variants, variant price/SKU overrides, and inventory
reservations and committed-inventory restoration. Apply the current
`supabase/reference/tenant-catalog.sql` to an
existing Supabase tenant project, then use the Tenant Owner database setup to
initialize the schema. MongoDB Atlas catalogs update their product validator
and advance to version 7 through the same initialize-schema action. Existing
platform Supabase projects must also apply
`supabase/migrations/0026_cod_order_cancellation.sql` for cancellation state
and redemption cleanup support. Paid Stripe orders remain non-cancellable
until a refund flow is implemented.

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
# Optional HMAC secret for signed carrier tracking events.
CARRIER_WEBHOOK_SECRET=<at-least-16-random-characters>
# Optional bearer token for protected Prometheus metrics scraping.
OBSERVABILITY_METRICS_TOKEN=<at-least-16-random-characters>
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
   `0016_tenant_storage_providers.sql`,
   `0017_order_fulfillment_tracking.sql`,
   `0018_checkout_shipping.sql`, `0019_discount_codes.sql`, and
   `0020_checkout_tax.sql`, `0021_host_updates.sql`,
   `0022_host_deletion.sql`, `0023_tenant_deletion.sql`,
   `0024_tenant_metadata_updates.sql`, `0025_product_reviews.sql`,
   `0026_cod_order_cancellation.sql`, `0027_order_delivery_status.sql`,
   `0028_stripe_refunds.sql`, and `0029_tenant_domain_removal.sql`.
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
- Host or tenant provider moves are not automatic. Require an explicit,
  reviewed migration/export plan, a protected pre-migration backup, secret
  rotation as needed, schema/data validation, cutover approval, and rollback
  coverage. Tenant host moves must preserve parent-host scope and domain ownership.
- Platform migration export is available for the file store:
  `npm run platform-store:migrate:export -- --dry-run` validates scope and
  reports counts without writing a file. Supplying a destination writes a
  checksummed, secret-free JSON envelope; raw password hashes and encrypted
  secret records are excluded. This is an export handoff, not a direct
  file-to-Supabase import or automated cutover. `npm run
platform-store:migrate:preflight -- <export-file>` verifies checksum and
  host/tenant/domain scope before a reviewed cutover. Automated import,
  credential re-encryption, and production cutover remain future work.
- Select an approved deployment region and keep platform/audit records and
  backups in that region unless a compliance review approves transfer. Design
  GDPR/DPDP export/deletion, PCI SAQ-A boundaries, tax retention, and provider
  residency controls for the selected region; do not imply that the application
  provides legal or tax compliance by configuration alone.
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
