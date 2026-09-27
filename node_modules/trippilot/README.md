# TripPilot

TripPilot is a React, Vite, TypeScript, and Tailwind prototype for traveler, operator, and vendor trip workflows.

## Run locally

```bash
npm install
npm run dev
```

## Prototype authentication

Authentication is intentionally isolated in `src/services/authService.ts` so it can be replaced by a backend API later. Sessions and prototype user data use browser storage only. Passwords are never stored as plaintext; locally registered accounts store a prototype-only credential fingerprint.

### Demo accounts

All demo accounts use the password `TripPilotDemo!`.

| Role | Email | Landing route |
| --- | --- | --- |
| Traveler | `traveler@trippilot.io` | `/traveler/onboarding` |
| Tour Operator | `operator@trippilot.io` | `/operator/dashboard` |
| Vendor | `vendor@trippilot.io` | `/vendor` |

## Route access

- `/login` and `/register` are public.
- `/traveler/*` requires a Traveler session.
- `/operator/*` requires a Tour Operator session.
- `/vendor/*` requires a Vendor session.

Unauthorized routes redirect to the matching role workspace or login. The selected light/dark theme is available on all application and authentication pages.
