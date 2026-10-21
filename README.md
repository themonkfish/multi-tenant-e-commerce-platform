# Multi-Tenant E-Commerce Platform

The repository separates the website frontend and the backend service scaffold:

- [`front-end/`](./front-end/) — Next.js application, platform adapters,
  migrations, and frontend documentation.
- [`back-end/`](./back-end/) — minimal Node.js HTTP service scaffold.
- [`tenant-back-end/`](./tenant-back-end/) — SQLite-backed tenant API for
  testing the frontend's health and catalog REST integration.

## Run locally

Install the frontend dependencies and configure its environment from the
frontend directory:

```powershell
cd front-end
npm install
Copy-Item .env.example .env.local
```

Generate the secrets described in [`front-end/README.md`](./front-end/README.md)
and add them to `front-end/.env.local`. Start the website from the repository
root with `npm run dev`, or from `front-end` with `npm run dev`.

Start the backend scaffold separately:

```powershell
npm run backend
```

It listens on `http://localhost:4000` by default and provides `GET /health`.
Set `PORT` to choose another port. This is a scaffold only; it is not yet
connected to the frontend or a tenant database.

## Test the tenant REST API

The configurable tenant API uses SQLite by default and requires Node.js 22.13
or newer. Set up its local API key and start it:

```powershell
Copy-Item tenant-back-end\.env.example tenant-back-end\.env
$key = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
(Get-Content tenant-back-end\.env) -replace '^TENANT_API_KEY=.*$', "TENANT_API_KEY=$key" | Set-Content tenant-back-end\.env
npm run tenant-backend
```

Run its API tests with `npm run test:tenant-backend`. See
[`tenant-back-end/README.md`](./tenant-back-end/README.md) for configuring
tenant IDs, SQLite files, REST requests, and the local HTTPS limitation when
connecting through the frontend proxy.

For complete website usage steps, see
[`front-end/USER_GUIDE.md`](./front-end/USER_GUIDE.md).

## Complete local demo

The demo command creates an isolated frontend platform store, tenant SQLite
database, generated credentials, and matching API configuration. It refuses to
overwrite any of those demo files and does not modify existing local data:

```powershell
npm run seed:demo
```

Then run `npm run tenant-backend:demo` and `npm run dev:demo` in separate
terminals. Read `front-end/.local/demo-credentials.txt` for the demo logins and
TOTP secret. Open `http://store.localhost:<port>/en` using the port printed by
Next.js. If `store.localhost` does not resolve on Windows, follow the hosts-file
note in the frontend README. See both application READMEs for the full setup
and safety notes.
