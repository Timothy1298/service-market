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

After applying migrations, seed the initial marketplace categories with `npm --workspace apps/api run db:seed`. The seed is idempotent and does not delete user data.

The API stores sessions in PostgreSQL through the `Session` model, so sessions survive API restarts. Logout and password reset invalidate server-side sessions. The application requires `SESSION_SECRET` to be at least 32 characters in production. `FRONTEND_ORIGIN` must match the browser origin when credentialed cookies are used.

Password recovery currently creates and hashes expiring, one-time reset tokens but does not deliver email or SMS. Configure a delivery adapter and the `MAIL_*` variables in `apps/api/.env` before enabling recovery in production. Recovery responses remain deliberately non-enumerating.

Run the focused automated checks with `npm test`. They cover the real registration validation schema without touching the development database. Full database-backed integration tests require a separate disposable test database.

## Password recovery

Development reset tokens are logged by the API only when `NODE_ENV=development`. Configure a real email/SMS delivery provider before production; reset tokens must never be logged in production.

## Phase 1 scope

Registration, login, logout, secure session restoration, password recovery foundation, role-aware dashboards, profile screens, provider business tenancy, and authorization foundations are implemented. Quotations, invoices, jobs, payments, subscriptions, M-Pesa, and marketplace discovery remain future phases.
# service-market
