# FundiQuote

FundiQuote is a mobile-first foundation for Kenyan fundis, technicians, contractors, and their customers.

## Setup

1. Ensure PostgreSQL is running and create `marketplace_db` owned by `marketplace_user`.
2. Copy `apps/api/.env.example` to `apps/api/.env` and set the local values. The existing `.env` is intentionally not committed.
3. Copy `apps/web/.env.example` to `apps/web/.env` if the API is not on port 4000.
4. Install dependencies with `npm install`.
5. Generate Prisma Client with `npm run prisma:generate`.
6. Apply the development migration with `npm run prisma:migrate`.

Run everything with `npm run dev`: it safely releases only ports 5000 and 5173, generates Prisma Client, applies committed migrations, and starts both services. The web app is at `http://localhost:5173` and the API health check is at `http://localhost:5000/api/health`.

Use `npm run prisma:migrate` only when creating a new migration. The normal development command uses `prisma migrate deploy`, so it does not require a Prisma shadow database or ask for a migration name.

After applying migrations, seed the fictional October 2026 demo workspace with the explicit opt-in command below. It is idempotent, refuses production, requires the database name to match, and does not delete or truncate user data:

```bash
ALLOW_DEMO_SEED=true DEMO_SEED_DATABASE=marketplace_db npm --workspace apps/api run db:seed
```

The seed creates Mwangaza Electrical & Maintenance with 24 customers, 18 quotations, 12 jobs, 20 materials, 10 invoices, payments, stock movements, 16 expenses, and a local subscription/payment test record. Demo login: `demo.provider@mwangaza.example` / `DemoPass123!`. These credentials and records are fictional and must not be used in production.

The API stores sessions in PostgreSQL through the `Session` model, so sessions survive API restarts. Logout and password reset invalidate server-side sessions. The application requires `SESSION_SECRET` to be at least 32 characters in production. `FRONTEND_ORIGIN` must match the browser origin when credentialed cookies are used.

Password recovery currently creates and hashes expiring, one-time reset tokens but does not deliver email or SMS. Configure a delivery adapter and the `MAIL_*` variables in `apps/api/.env` before enabling recovery in production. Recovery responses remain deliberately non-enumerating.

Run the focused automated checks with `npm test`. They cover the real registration validation schema without touching the development database. Full database-backed integration tests require a separate disposable test database.

## Password recovery

Development reset tokens are logged by the API only when `NODE_ENV=development`. Configure a real email/SMS delivery provider before production; reset tokens must never be logged in production.

## Current scope

The repository includes authentication, marketplace discovery, customer records, quotations, public quotation acceptance, jobs, inventory, invoices, manual payments, receipts, expenses, reports, subscription records, and a Daraja STK Push integration boundary.

## Production checklist

- Apply migrations explicitly with `npm run prisma:migrate`; production startup should use `npm run prisma:deploy`.
- Set a strong `SESSION_SECRET`, exact `FRONTEND_ORIGIN`, HTTPS, and a publicly reachable HTTPS `MPESA_CALLBACK_URL`.
- Configure `MPESA_ENVIRONMENT`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, and `MPESA_PASSKEY` only in `apps/api/.env` or a secret manager.
- Live M-Pesa remains unverified until valid Safaricom sandbox/production credentials are supplied and callbacks are observed.
- Run database tests only with `RUN_DB_TESTS=true`, `TEST_DATABASE_URL` set to a disposable database URL, and `DATABASE_URL` set to the exact same test URL. The test guard refuses the normal `marketplace_db` database.
- Use `npm run typecheck`, `npm test`, and `npm --workspace apps/web run build` before release.

Automatic recurring billing, live payment reconciliation, email/SMS delivery, and advanced admin operations require additional production configuration or future work.
