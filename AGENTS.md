<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# MizoramStay — Agent Coding Guidelines

These instructions apply to **all** coding agents working in this repository. Read this entire section before writing or modifying any code.

## 1. Research Before You Write Code

### 1.1 Always consult official documentation via Context7 MCP

Before implementing any feature, API, library, or architecture decision, **search the official documentation using the Context7 MCP server** (`mcp_context7_resolve-library-id` → `mcp_context7_get-library-docs`). This applies to every dependency in this project, including but not limited to:

- **Next.js 16** — App Router, Server Components, Route Handlers, caching, metadata, `use cache`, `cacheLife`, `cacheTag`
- **React 19** — Server Components, Actions, `use()`, ref improvements, composition patterns
- **Supabase** (`@supabase/ssr`, `@supabase/supabase-js`) — Auth, Storage, Postgres/RLS, Edge Functions, Realtime, Cron
- **Tailwind CSS v4** — utility-first styling, CSS-first configuration (no `tailwind.config.js`), `@theme` directives
- **shadcn/ui** — component system, CLI, presets, composition patterns
- **Zod v4** — schema validation
- **react-hook-form** — form state management
- Any other library you intend to use

**Do not rely on training-data assumptions** — APIs change across major versions. Verify signatures, conventions, and deprecations against current official docs before writing code.

### 1.2 Always use relevant skills before implementing

Before writing or changing any code, check the **global skills directory** at `C:\Users\USER\.agents\skills` (and any other skills VS Code can access) and load the skill(s) relevant to the task. Read the skill's `SKILL.md` and follow its guidance. Relevant skills for this project include (but are not limited to):

| Domain | Skills |
|---|---|
| Next.js / React | `next-best-practices`, `next-cache-components`, `next-upgrade`, `vercel-react-best-practices`, `vercel-composition-patterns` |
| Styling / UI | `tailwind-4-docs`, `shadcn`, `shadcn-ui`, `ant-design-react` |
| Database | `supabase-postgres-best-practices` |
| Python (if applicable) | `fastapi-python`, `fastapi-async-patterns`, `pydantic`, `pytest` |
| Quality / Design | `web-design-guidelines` |
| Tooling | `context7-mcp` — how to use the Context7 MCP server |

If a task falls within a skill's domain, **read and follow that skill** before writing code.

---

## 2. Project Architecture & Best Practices

### 2.1 Technology Stack

| Layer | Technology |
|---|---|
| Framework | **Next.js 16** (App Router) |
| UI | **React 19** + **TypeScript** (strict mode) |
| Styling | **Tailwind CSS v4** (CSS-first config) |
| Components | **shadcn/ui** (Base UI primitives, source in `src/components/ui/`) |
| Backend / DB | **Supabase** — Postgres 17, Auth, Storage, Realtime, Edge Functions, PostGIS, pgvector, Cron |
| Validation | **Zod v4** for schemas, **react-hook-form** for form state |
| Deployment | **Vercel** (Next.js) + **Supabase** (hosted) |
| Testing | **Vitest** (unit + integration), **Playwright** (e2e) |

### 2.2 Directory Structure & Conventions

```
src/
├── app/                        # Next.js App Router pages and layouts
│   ├── (public)/               # Public-facing tourist pages (optional grouping)
│   ├── admin/                  # Admin portal pages
│   ├── host/                   # Host portal pages
│   ├── booking/                # Booking flow pages
│   ├── api/v1/                 # API route handlers
│   └── layout.tsx              # Root layout
├── components/
│   ├── ui/                     # shadcn/ui components (DO NOT edit — use CLI)
│   ├── admin/                  # Admin-specific components
│   ├── booking/                # Booking-specific components
│   ├── host/                   # Host-specific components
│   ├── realtime/               # Realtime subscription components
│   ├── reviews/                # Review components
│   └── support/                # Support components
├── features/                   # Feature modules (business logic)
│   ├── properties/             # Property domain logic
│   └── search/                 # Search domain logic
├── lib/
│   ├── supabase/               # Supabase client factories
│   │   ├── server.ts           # Server Components / Route Handlers
│   │   ├── browser.ts          # Client Components
│   │   └── admin.ts            # Service-role (admin) client
│   └── validation/             # Shared Zod schemas
└── types/                      # Shared domain types
```

**Key rules:**
- **Feature-based organization**: business logic lives under `src/features/<domain>/`. Each feature folder contains its own services, hooks, types, and helpers. Keep domain logic inside its feature folder — do not leak it into `src/app/`.
- **App routes are thin**: `src/app/` pages should only handle routing, layout, and rendering. Delegate all business logic to feature modules and services.
- **Supabase clients**: always import from `src/lib/supabase/`. Never create ad-hoc Supabase clients. Use `server.ts` in Server Components/Route Handlers, `browser.ts` in client components, and `admin.ts` only in privileged server contexts.
- **Shared types**: domain types live in `src/types/` (e.g. `marketplace.ts`). Keep DB enum values and application types in sync with the Supabase schema.
- **shadcn/ui components**: source lives in `src/components/ui/`. Use the shadcn CLI to add new components. Do not hand-edit generated component files unless fixing a bug — override via props or wrapper components instead.

### 2.3 Database & Migrations

- All schema changes go under `supabase/migrations/` using the naming convention: `YYYYMMDDHHMMSS_description.sql` (e.g. `20260831105000_initial_marketplace.sql`).
- Apply migrations via the Supabase MCP (`mcp_supabase_apply_migration`) **and** log the same SQL as a local migration file. Keep local files in sync with what is applied remotely.
- **Row Level Security (RLS)** is mandatory on every table. Always add explicit policies. Never expose `SECURITY DEFINER` functions to `anon` or `authenticated` unless intentional — revoke `EXECUTE` where not needed.
- Database domains in this project: Users/Auth, Properties, Rooms, Availability, Pricing, Bookings, Payments, Payouts, Reviews, Destinations, Experiences, Transport, Verification, Support, Analytics, Audit.
- Use **PostGIS** for geospatial queries (property proximity, destination mapping). Use **pgvector** for future AI embedding/recommendation features.

### 2.4 Edge Functions

Edge Functions live under `supabase/functions/`. Current functions:

| Function | Purpose |
|---|---|
| `_shared/` | Shared utilities across functions |
| `create-razorpay-order` | Initiate Razorpay payment orders |
| `razorpay-webhook` | Handle Razorpay payment callbacks |
| `process-payouts` | Execute host payout transfers |
| `release-expired-holds` | Release timed-out inventory holds (Cron-triggered) |
| `complete-stays` | Mark check-outs as completed |
| `refund-payment` | Process booking refunds |
| `send-notification` | Dispatch email/SMS/WhatsApp notifications |

When adding a new Edge Function, ensure it:
- Is idempotent where possible (especially payment-related functions)
- Uses the shared utilities in `_shared/`
- Validates input rigorously
- Returns structured JSON responses

### 2.5 Code Quality

- **TypeScript strict mode** is enforced. Avoid `any` unless absolutely unavoidable — prefer `unknown` and narrow with type guards.
- **Validate all external input** with Zod schemas (API params, form data, search queries, URL segments).
- **Prefer Server Components by default**. Only add `"use client"` where genuine interactivity is required (event handlers, browser APIs, React state).
- **Keep components small and composable**. Follow React composition patterns — avoid boolean prop proliferation; use compound components or render props where appropriate.
- **Naming**: components use PascalCase, utilities use camelCase, files use kebab-case or match the component name.
- **Tailwind CSS v4**: use semantic design tokens (`bg-primary`, `text-muted-foreground`, etc.) mapped in `src/app/globals.css`. Never use raw hex values in component class names.
- Run `npm run lint` and `npm run typecheck` before finishing changes. Resolve all errors and warnings.
- Do not commit secrets, API keys, or environment values. Use `.env.local` for local development and Vercel environment variables for production.

---

## 3. Verification Before Completion

After making changes, **always** run the relevant checks and confirm they pass:

```bash
npm run typecheck      # TypeScript compilation
npm run lint           # ESLint
npm run build          # Full production build
npm run test           # Unit + integration tests (Vitest)
npm run test:e2e       # End-to-end tests (Playwright)
```

- For **database changes**, verify the result (e.g. query the schema, check policies via Supabase MCP) rather than assuming success.
- For **UI changes**, visually verify in the browser where possible — check responsive layout, dark mode (if applicable), and accessibility.
- **Do not claim a change is complete without fresh verification output.** If a test fails, investigate and fix before reporting success.

---

## 4. Booking & Payment Flow — Critical Rules

The booking/payment pipeline is the most sensitive part of the system. Follow these rules without exception:

- **The client must never be the source of truth for payment success or booking confirmation.** Only the server-side webhook handler (`razorpay-webhook` Edge Function) can confirm a booking.
- **Inventory holds are temporary.** If payment is not confirmed within the hold window, the `release-expired-holds` cron must free the inventory automatically.
- **All payment operations must be idempotent.** Use `provider_transaction_id` to deduplicate webhook events.
- **Concurrency control is essential.** Use database-level locking (e.g. `SELECT ... FOR UPDATE`, advisory locks, or atomic RPC calls) to prevent double-booking of the same room on the same dates.
- **Refunds flow through the platform** — never refund directly from the host. Use the `refund-payment` Edge Function.
- **Payout records** (`host_payouts`) must accurately reflect gross amount, platform commission, payment processing costs, refund adjustments, and net payout. These are the financial source of truth.

---

## 5. Security & Privacy

- **RLS on every table** — no exceptions. Test policies with different roles (anon, authenticated, host, admin).
- **Sensitive documents** (identity proofs, ownership records, bank details) must use private Storage buckets with signed-URL access only. Never expose these publicly.
- **Admin operations** require elevated privileges. Use the admin Supabase client (`src/lib/supabase/admin.ts`) only in server-side contexts.
- **Audit logging**: every verification decision, booking status change, and payment event must be recorded in `audit_logs`. Do not expose audit records to non-admin users.
- **PII minimization**: collect only what is necessary. Avoid storing full identity documents in the database — store URLs to Storage objects instead.
- **HTTPS everywhere**. No mixed content. Secure all API endpoints.

---

## 6. Testing Strategy

| Test Type | Tool | Location | Purpose |
|---|---|---|---|
| Unit | Vitest | `tests/unit/` | Validate individual functions and schemas |
| Integration | Vitest | `tests/integration/` | Full booking lifecycle, auth flows, payment flows |
| Phase contracts | Vitest | `tests/phase2/`, `tests/phase3/`, `tests/phase4/` | API route contracts and validation per phase |
| E2E | Playwright | `tests/e2e/` | Browser-based user journeys |

**Critical flows that MUST have tests:**
- Host registration → property approval
- Tourist search → availability check → booking → payment → confirmation
- Booking cancellation → refund processing
- Host payout generation
- Review submission (only from completed bookings)
- RLS policy enforcement (verify unauthorized access is blocked)

Run the full test suite before merging any changes:
```bash
npm run test && npm run test:e2e
```

---

## 7. Phase Awareness

This project follows a phased development roadmap. Be aware of what is in scope:

- **Phase 2 (Property Marketplace)**: host registration, property onboarding, verification, rooms, media, availability, pricing, search, SEO property pages
- **Phase 3 (Booking & Payments)**: transactional booking RPCs, Razorpay integration, webhook verification, cancellation/refunds, payout records, notifications
- **Phase 4 (Reviews & Operations)**: reviews, support, verification admin, analytics, Realtime, scheduled jobs

Do not build features outside the current phase unless explicitly instructed. If you identify a future dependency, note it but do not implement premature abstractions.

---

## 8. Git & Deployment

- **Branch strategy**: feature branches from `main`, PR-based merges.
- **CI/CD pipeline**: Pull Request → Lint → Type Check → Unit Tests → Build → Preview Deployment (Vercel) → E2E Tests → Production.
- **Supabase migrations** are committed to the repository and promoted through environment lifecycle (local → staging → production).
- **Never force-push to `main`.** Never skip CI checks.
- **Commit messages**: use conventional commits format (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- **Environment variables**: document any new `.env` requirements in `.env.example` and the README.

---

## 9. Design & UX Principles

- **Tourist experience**: emotionally driven, visual, discovery-oriented. Photography-first design. Use local Mizoram landscape and property imagery extensively.
- **Host experience**: operational, simple, task-oriented. Mobile-first. A host should be able to manage bookings, update availability, and respond to guests entirely from their phone.
- **Admin experience**: data-heavy, workflow-oriented. Verification dashboards, analytics, and moderation tools.
- **Trust signals**: verification badges (Identity Verified, Documents Verified, Tourism Registration Verified, Property Verified) must be visually prominent and explain what each level means when clicked.
- **Accessibility**: target WCAG 2.2 AA. Ensure keyboard navigation, alt text, sufficient contrast, screen-reader support, and large touch targets.
- **SEO**: every destination and property page must have proper metadata, Open Graph tags, structured data (JSON-LD), canonical URLs, and sitemap entries.

---

## 10. Do Not

- Do not use `any` type without a `// eslint-disable` comment explaining why.
- Do not create Supabase clients outside of `src/lib/supabase/`.
- Do not store or log API keys, passwords, or tokens in source code.
- Do not add dependencies without checking Context7 docs for the correct, current package name and installation method.
- Do not use `use client` unless the component genuinely requires browser-side interactivity.
- Do not bypass RLS — always test with appropriate roles.
- Do not make changes to `src/components/ui/` via hand-edits; use the shadcn CLI.
- Do not skip running `npm run lint` and `npm run typecheck` before considering a task complete.
- Do not implement payment logic in client-side code — all payment operations are server-side only.
- Do not merge incomplete or untested changes.
