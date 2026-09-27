# Voyara PS ID 7 — Complete Project

Voyara is a personalized tour planning and operations platform. It keeps the **Personalised Tour Planning** React interface and provides the traveler lifecycle, operator operations center, role-scoped coordinator schedule, PostgreSQL-backed inventory, itinerary recovery, and live notifications.

## Start on Windows

Requirements: Node.js 20+, Docker Desktop (or a local PostgreSQL 16 server).

1. In PowerShell at the project root, install packages and start PostgreSQL:
   ```powershell
   npm install
   docker compose up -d db
   ```
2. Copy `backend/.env.example` to `backend/.env`. It is preconfigured for the local Compose database. Change `JWT_SECRET` to a private random value before exposing the app beyond your machine.
3. Create the database schema and demo records:
   ```powershell
   npm run db:migrate
   npm run db:seed
   ```
4. In separate terminals from this folder, run:
   ```powershell
   npm run dev:backend
   npm run dev:frontend
   ```
5. Open `http://localhost:5173`.

Seeded accounts use password `TripPilotDemo!`:

| Role | Email |
| --- | --- |
| Traveler | `traveler@trippilot.io` |
| Operator | `operator@trippilot.io` |
| Vendor | `vendor@trippilot.io` |

A coordinator can register with the Coordinator role. An operator can assign that coordinator to a tour from **Customers & Resources → Coordinators**.

## End-to-end demo

1. Sign in as the traveler and complete onboarding with destination, dates, budget, interests, accommodation, transport, and travel pace.
2. Generate a personalized itinerary from verified/demo inventory. Review the price and preference fit; edit or swap items and watch the trip budget recalculate.
3. Confirm a booking through simulated checkout and open the live-trip, preparation, assistant, and notification pages.
4. Simulate a flight or activity disruption. The dependency engine identifies affected downstream items and creates cost/time/preference/reliability ranked recovery proposals.
5. Sign in as an operator in a second browser session. Review the operations queue and approve or reject the proposal. Approved changes update the itinerary and notify trip stakeholders.
6. In **Customers & Resources**, inspect customers and trip history, manage hotel/transport/activity inventory and availability, assign coordinators, and edit itinerary schedules. Schedule edits run the existing conflict validator and emit a traveler notification.
7. Sign in as the coordinator to see only tours assigned to that account. Finish the traveler flow with a review to update future preference weights.

## Implemented areas

- **Traveler:** preferences and onboarding, destination discovery, itinerary generation and customization, budget allocation and simulation, comparison, bookings and payments, trip dashboard, itinerary, preparation checklist, assistant/nearby help, group planning, completion and reviews.
- **Operator:** command-center KPIs and risk queue, disruption analysis and human approvals, vendors, marketplace, groups, payments/refunds, analytics, customer trip history, hotel/transport/activity inventory management (including room, driver/vehicle, duration, and capacity metadata), coordinator directory/assignment, and schedule editing.
- **Coordinator:** role-based sign-in and a schedule view scoped to assigned trips.
- **Intelligence and operations:** inventory-constrained planning, dependency graph and conflict checks, disruption alternatives ranked by budget/time/preference/provider reliability, explicit human approval, persisted in-app notifications, SSE live updates, weather monitoring, and activity logs.

## Integrations and scope

The app works in seeded demo mode without provider keys. Groq itinerary assistance, live flight/hotel/place providers, currency conversion, weather data, and real payment gateways need network access and/or credentials; checkout otherwise uses the built-in simulated payment provider. Maps, email/push delivery, actual vendor settlement, and real supplier reservations require external services and credentials, so this package does not claim those live services are configured. Keep secrets in the local untracked `.env` files; do not commit them.

For API/provider configuration and troubleshooting, see `README.md` and `backend/.env.example`. For the production bundle command, run `npm run build`.



## Merge notes: Admin console added from Voyara_FINAL_WORKING_QA_v2

This package is Voyara PS ID 7 (this UI/stack is the base) with the one feature from the
`Voyara_FINAL_WORKING_QA_v2` build that this project did not already have: a platform **Admin**
console. Every other QA v2 feature (destination discovery/explore, refunds, comparisons, etc.)
already exists here under this app's own naming, so it was left as-is rather than duplicated.

What's new:
- **Role:** `ADMIN` added to the `Role` enum (migration `20260926180000_admin_console`).
- **Backend routes** (`requireAuth` + `allowRoles(Role.ADMIN)`):
  - `GET /api/admin/overview` — users by role, trips by status, provider count, platform revenue,
    open disruptions, pending approvals, recent activity.
  - `GET /api/admin/users`, `PATCH /api/admin/users/:id` — search/list every account and change a
    user's role.
  - `GET /api/admin/audit-logs` — reads the existing `ActivityLog` table platform-wide.
  - `GET/PATCH /api/admin/settings` — a new single-row `PlatformSettings` table (platform name,
    support email, maintenance mode, booking fee %).
  - The existing operator vendor routes (`/api/vendors`) now also allow `ADMIN`, so the admin
    Providers page reuses the same vendor directory operators already manage.
- **Frontend:** `/admin/overview`, `/admin/users`, `/admin/providers`, `/admin/audit-logs`,
  `/admin/settings`, all behind the existing `RoleGuard`/`ProtectedRoute` pattern, styled with the
  same `Card`/`Button`/operator-table classes the rest of the app already uses. A public `/about`
  page was also added.
- **Seed:** a demo admin account was added — `admin@trippilot.io` / `TripPilotDemo!`.

To apply: run `npm run db:migrate` (or `npx prisma migrate deploy`) as usual — the new migration
file runs alongside the existing ones. No existing table, column, or enum value was changed.
