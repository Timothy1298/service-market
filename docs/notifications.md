# Notifications and delivery worker

FundiQuote persists business events in `NotificationEvent` inside the same database transaction as supported business changes. The API process claims outbox events, creates per-recipient `Notification` rows, and persists optional `NotificationDelivery` rows. Unique idempotency keys protect retries and duplicate callbacks.

## Development and deployment

`npm run dev` starts the API process. When the API is started as the main process, it runs a database-backed worker every five seconds and reminder scheduling every five minutes. The same API process retries delivery failures with exponential backoff, recovers stale processing rows, and performs expiry cleanup. Graceful SIGINT/SIGTERM shutdown stops the timers and closes PostgreSQL connections.

Production must run a long-lived API process for the embedded worker. The worker is safe to run in more than one API instance because events and deliveries are claimed through conditional database updates. For serverless deployments, run the API as a long-lived worker service or add a platform scheduler that invokes an authenticated internal worker endpoint; this repository does not expose a public worker endpoint.

The current reminder scheduler generates idempotent notices for invoices due soon/overdue, quotations expiring soon, scheduled jobs and subscriptions nearing or past expiry. It runs using each business's configured IANA timezone. Reminder schedules are evaluated every five minutes.

## Optional channels

In-app notifications are always available and do not need credentials. Optional external delivery is disabled unless both user preferences and business settings allow it.

- Email uses the Brevo transactional email API. Set `BREVO_API_KEY`, `BREVO_FROM_EMAIL` (a verified Brevo sender address), optional `BREVO_SENDER_NAME`, and `APP_BASE_URL`. `APP_BASE_URL` is the public origin such as `https://app.example.com`.
- SMS uses the Africa's Talking messaging API. Set `AT_API_KEY`, `AT_USERNAME`, and optionally `AT_SENDER_ID`. Use provider sandbox credentials for development and a registered sender ID in production where required.
- WhatsApp is not implemented or advertised as available.

Provider acceptance is recorded as `SENT`, not `DELIVERED`; a delivered state requires a configured provider event webhook, which is not currently integrated. Brevo does not document an idempotency key for the send endpoint, so an ambiguous network timeout can still lead to a duplicate on retry. SMS provider timeout ambiguity cannot be eliminated without provider-side idempotency support.

## API surface

Authenticated endpoints under `/api/notifications` provide paginated list/search/category/date filters, unread counts, read/unread/archive/delete actions, personal channel/category/quiet-hour preferences, and owner/admin-only delivery diagnostics. Diagnostics omit recipient addresses and provider credentials.

Apply the additive migration with `npm run prisma:deploy` after reviewing the SQL. No credentials are returned by channel-status endpoints.
