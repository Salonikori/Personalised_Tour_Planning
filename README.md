# Voyara — PS ID 7

Voyara is a React/Vite traveler experience backed by an Express, Prisma, and PostgreSQL operational API. The app includes inventory-constrained itinerary generation, recovery planning, live operator updates, checkout (real test-mode payment gateway, with a simulated fallback), a what-if preview, and review-driven preference learning.

## Install and configure

```bash
npm install
copy backend/.env.example backend/.env
docker compose up -d db
```

Set `DATABASE_URL`, `JWT_SECRET`, `PORT`, and `FRONTEND_ORIGIN` in `backend/.env`. `GROQ_API_KEY` (a [Groq](https://console.groq.com) key, used to call the `openai/gpt-oss-120b` model) is optional: without it, the backend uses its deterministic, verified-inventory demo generator; it is never exposed to the browser. Optionally set `VITE_API_URL` in `frontend/.env` (default: `http://localhost:4000/api`).

Never commit a real `GROQ_API_KEY` value — keep `backend/.env` out of version control (see `.gitignore`) and only put real secrets in your local, untracked `.env` file.

### Checkout payments
By default (`PAYMENT_PROVIDER` unset) checkout uses the built-in simulated payment flow, exactly as
before — no keys required. To exercise a real test-mode gateway instead:

- **Stripe**: set `PAYMENT_PROVIDER=stripe` and `STRIPE_SECRET_KEY` (a `sk_test_...` key). Checkout
  confirms a real Stripe test-mode PaymentIntent server-side using Stripe's `pm_card_visa` test
  token, so it completes synchronously with no frontend changes needed.
- **Razorpay**: set `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, and `RAZORPAY_KEY_SECRET` (test
  keys). Checkout creates a real Razorpay Order; the traveler completes payment via the Razorpay
  Checkout widget (wired up in `BookingPage.tsx`), and the backend verifies the HMAC signature at
  `POST /api/trips/:id/checkout/verify` before marking anything paid.
- If the flag is set but its keys are missing, the backend logs a warning and falls back to the
  simulated flow rather than failing checkout.
- See `backend/src/services/providers/paymentProvider.ts` for the full provider implementation and
  `CHANGES-payment-gateway-v7.md` for what changed and why.

## Database

```bash
npm run db:migrate
npm run db:seed
```

The seed creates one polished Bali demo trip, six vendors, 28 verified inventory records, connected flight → transfer → hotel → activity dependencies, paid/pending bookings, and a prepared weather disruption.

## Run

In separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

Validate production code with:

```bash
npm run build
```

## Trip planning workflow

The current workflow is: account creation → source/destination and dates → destination places/activities with optional day assignment → traveler count, trip type, pace and budget → automatic or preference-led itinerary generation → traveler edits → **admin review** → approval or requested changes → **payment unlocked only after approval** → booking.

Additional traveler features are grouped under **More**: Group Trip, Edit Itinerary, Business Trips and Carry List. During a booked trip, adding an itinerary item records an additional-charge adjustment and removing an item records a refund adjustment. Existing disruption recovery and SOS flows remain available during the live trip.

For a fresh checkout of the updated database, run `npm run db:deploy` after starting PostgreSQL. The root `postinstall` generates the Prisma client automatically after `npm install`.

Admin demo: `admin@trippilot.io` / `TripPilotDemo!`. Trip approvals are available under **Admin → Trip Reviews**.

## Demo accounts

All seeded accounts use password `TripPilotDemo!`.

| Role | Email |
| --- | --- |
| Traveler | `traveler@trippilot.io` |
| Operator | `operator@trippilot.io` |
| Vendor | `vendor@trippilot.io` |

## Architecture

- `frontend/`: existing React/Vite UI, ThemeProvider, live SSE subscriptions, and API-facing screen services.
- `backend/`: Express API, JWT/role protection, Prisma schema/seed, recovery/AI/preference services.
- `docker-compose.yml`: local PostgreSQL 16 service for development.
- PostgreSQL models include User, Trip, InventoryItem, ItineraryItem, Booking, PaymentAudit, Disruption, RecoveryPlan, ItinerarySnapshot, Simulation, Review, and ActivityLog.
- SSE at `/api/events` propagates disruption, recovery, checkout, simulation, and review changes to traveler and operator screens.
- Durable in-app alerts are stored in the `Notification` table for the affected traveler and all operators. The navigation Alerts menu loads the most recent 50 alerts on sign-in and receives recipient-scoped `notification` SSE events for disruptions and recovery status changes; opening an alert marks it read.
- Inventory discovered from live providers keeps its `currency:<ISO>` tag. Wallet line items now display that native amount plus an approximate home-currency subtotal. Rates come from the no-key [Frankfurter API](https://frankfurter.dev/) and are stored in the `FxRate` table once per currency pair per UTC day. The home currency is `preferences.homeCurrency` when set, otherwise `HOME_CURRENCY` (default `INR`).
- On startup and every six hours, the backend geocodes each upcoming trip with Open-Meteo and checks the portion of its date range that falls inside the provider's 16-day forecast window. A weather disruption is created automatically for thunderstorms (WMO 95+), gusts of 75 km/h+, 50 mm+ daily precipitation, or a 90%+ chance of at least 25 mm precipitation. Each alert includes a stable date marker, so repeated runs do not duplicate it; the event is delivered through the existing SSE channel. Set `WEATHER_CHECK_INTERVAL_MS` to adjust the cadence (minimum five minutes). No API key is needed.

## AI and safety

Groq is backend-only. Structured itinerary output is Zod-validated; inventory IDs and prices are verified server-side; preference and recovery scores are calculated deterministically. AI can propose or request backend tools, but does not directly write the database. Checkout, recovery approval, swaps, and simulation changes require an explicit UI action.

## Known limitations

- Destination discovery works for **any destination the traveler types**, not a fixed list. `backend/src/services/destinationService.ts` calls the live Nominatim and Overpass (OpenStreetMap) APIs to find real places for a destination, and `backend/src/services/travelDiscoveryAIService.ts` additionally resolves live hotels/flights/places via Amadeus, OpenStreetMap, and web search for whatever city is entered.
- A small curated catalog exists in `destinationService.ts`'s `offlineCatalog` for five example cities (Delhi, Mumbai, Goa, Paris, Tokyo). This is a **bonus resilience fallback only** — used purely so the demo still has something to show if live discovery is briefly unreachable for one of those five — not the definition of what's "supported." Add more cities there only to widen offline demo resilience, not to "add support" for a destination.
- For any other destination, if live discovery is temporarily unreachable (e.g. Nominatim/Overpass can't be reached), the backend throws a dedicated `DestinationDiscoveryUnavailableError` and the API responds `503 { error, retryable: true }` — an honest, retryable "please try again" rather than a message implying the destination itself isn't supported.

## Hackathon demo flow

1. Sign in as the traveler and use the seeded Bali trip.
2. View Composer, Canvas, Wallet, and Checkout.
3. Trigger the 90-minute flight-delay disruption or ask Copilot about a rain cancellation.
4. In a second browser session as the operator, watch Command Center / Disruption Console receive the event and approve a recovery plan.
5. Observe Canvas, Twin, Wallet, and settlement data refresh through SSE.
6. Complete vendor reviews; their tags and ratings update the traveler preference weights used in subsequent Composer runs.


## Weather-driven digital twin

The traveler Trip Digital Twin (`/traveler/twin`) now combines the selected trip's actual itinerary with live/current and seven-day forecast conditions from the no-key Open-Meteo API. Destination geocoding uses Open-Meteo. Rain probability and temperature sliders run a read-only counterfactual and estimate exposure, disruption probability, and expected delays for each itinerary item. These are indicative estimates with an uncertainty range; simulations never change real bookings or itinerary data.

The page includes an OpenStreetMap destination map and recent publicly accessible social/news context from the Bluesky public search API and GDELT. Social/news feeds may be empty when a provider is unavailable or returns no matching public posts. The backend proxies these requests so browser CORS does not block them. The weather twin endpoint is authenticated and applies the same trip ownership check as other trip data. The existing automatic severe-weather monitoring and disruption workflow remains in place.

The onboarding flow uses the bundled destination photos for Brazil, Goa, Italy, Japan, Kashmir, and Kolkata in destination inspiration and place/activity choice cards. These images are served locally; other destinations keep the existing generic fallback.

Run the app as usual (`npm install`, configure backend `.env` from `backend/.env.example`, run database migrations/seed as needed, then `npm run dev`). Weather, map tiles and public signals require network access; no weather or social API key is needed.

## Nugen Intelligence domain alignment (HackCelestial 3.0)

Voyara includes a hospitality/travel weather-impact alignment corpus at `backend/data/voyara-weather-alignment.txt`, a Nugen setup script, and Nugen chat-completion inference in the live weather twin. The simulation calls the configured aligned model with the current scenario and itinerary. It validates item coverage and bounds returned estimates; when Nugen is unconfigured or unavailable, the twin reports local-estimate mode and remains usable.

To complete the required Nugen customization, create a Nugen API key and add it to `backend/.env` as `NUGEN_API_KEY`. From the repository root, upload the domain corpus with `npm run nugen:align --workspace backend`. Wait until the returned document ID reports `READY` in Nugen. Then rerun with that ID and alignment creation enabled (PowerShell example): `$env:NUGEN_DOCUMENT_IDS='YOUR_DOCUMENT_ID'; $env:NUGEN_CREATE_ALIGNMENT='true'; npm run nugen:align --workspace backend`. The script defaults to Nugen's documented `qwen-v2p5-0p5b-instruct` base model; set `NUGEN_BASE_MODEL_ID` if the account uses another supported base model. Nugen alignment is asynchronous: wait for the project status to become `COMPLETED`, deploy the returned aligned model in Nugen, and set `NUGEN_ALIGNED_MODEL_ID` in `backend/.env` to its returned `model_id`. Restart the backend. The twin then labels results `Nugen-aligned model` and uses it for each what-if inference.

Do not put the Nugen API key in frontend environment variables or commit `.env`. Alignment requires a Nugen account/API key and the resulting document/model IDs; these are intentionally not fabricated or embedded in the ZIP.
