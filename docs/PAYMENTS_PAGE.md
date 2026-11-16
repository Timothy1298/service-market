# Payments page

## Scope
The Payments screen is a narrow provider-only ledger for customer receipts.

## Reuse map
- Reused the existing invoice payment contract from `/api/invoices/:id/payments`.
- Reused the Jobs page layout pattern for header, metrics cards, search, and empty/loading states.
- Reused the invoice detail payment form pattern for amount/method/date/reference capture.
- Reused the dashboard data contract for `/api/payments` so the summary cards stay consistent.

## API contract
- `GET /api/payments` — provider-only payment ledger for the business.
- `POST /api/invoices/:id/payments` — record a payment against an issued invoice.

## UX notes
- Search filters by invoice number, customer name, payment reference, or method.
- Metrics include total payments, cashflow, today’s receipts, and unique invoice count.
- The modal validates amount, outstanding balance, and method.

## Validation
- `npm run typecheck`
- `npm test -- --runInBand`
