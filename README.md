# MizoramStay

A mobile-first marketplace for verified stays in Mizoram, built with Next.js, TypeScript, Tailwind CSS, Supabase and Razorpay.

## Implemented roadmap scope

- Public, date/guest/inventory-aware stay discovery and live property pages
- Authenticated host onboarding, property editing, amenities, rooms, media/documents, inventory and pricing
- Auditable administrator property verification and publication workflow
- Transaction-safe, idempotent booking holds with row-locked nightly inventory
- Razorpay order creation and raw-body HMAC webhook confirmation
- Traveller booking details, confirmation, cancellation and refund status
- Exactly-once inventory restoration for expired or cancelled bookings
- Durable refunds, host payouts, notification outbox and reconciliation operations
- Completed-stay review eligibility, moderation and host responses
- Private support cases, threaded messages, assignment and resolution workflows
- Admin audit explorer and privacy-safe marketplace analytics
- RLS-filtered Realtime refresh for booking, verification and support operations
- RLS for public, traveller, host and administrator access boundaries

## Local setup

1. Copy `.env.example` to `.env.local` and populate the required values.
2. Link the Supabase project and apply every migration in `supabase/migrations` in timestamp order.
3. Deploy the functions under `supabase/functions`; `supabase/config.toml` contains their JWT settings.
4. Apply `supabase/seed.sql` only in a development environment.
5. Run `npm run dev`.

## Required function secrets

- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- `CRON_SECRET`
- `APP_ORIGIN`
- `RESEND_API_KEY`, `EMAIL_FROM`
- `RAZORPAY_PAYOUT_ACCOUNT_NUMBER` for activated RazorpayX payouts

Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions.

## Scheduled operations

Invoke `release-expired-holds` every minute, `send-notification` every minute, `process-payouts` every five minutes, and `complete-stays` hourly from trusted Supabase Cron jobs using `CRON_SECRET`. Never expose these worker endpoints to browsers. The Razorpay webhook must be deployed with JWT verification disabled; every user-facing function keeps JWT verification enabled.

## Quality gates

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:integration` with dedicated test-account environment variables
- `npm run test:e2e`
- `npm run build`

The MVP excludes native apps, restaurant/taxi marketplaces, dynamic pricing, advanced AI, and live payments until the Razorpay production account and operational controls are approved.
