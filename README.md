# Booking App — Backend

REST API for a multi-tenant appointment-booking platform. Multiple independent
businesses (salons, clinics, studios) share one deployment, one database, and
one codebase, each fully isolated behind its own URL slug and admin account.

Node.js · Express 5 · PostgreSQL (Neon) · Prisma ORM · JWT auth · Twilio Verify (SMS OTP)

---

## Table of contents

- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Data model](#data-model)
- [API overview](#api-overview)
- [Notable design decisions](#notable-design-decisions)
- [Known limitations](#known-limitations)
- [Deployment](#deployment)

---

## Architecture

```text
Browser (React SPA)
   │  fetch() + Authorization: Bearer <JWT>
   ▼
Express app (app.js)
   │
   ├─ cors → express.json() → [authenticateToken] → [resolveBusinessBySlug]
   │
   ├─ routes/*.js          → thin route definitions, no logic
   │     │
   │     ▼
   ├─ controllers/*.js     → business logic, validation, Prisma calls
   │     │
   │     ▼
   └─ Prisma Client → PostgreSQL (Neon, serverless)
```

### Multi-tenancy model

Single shared database, single schema, **row-level isolation**. Every
tenant-scoped table (`Service`, `Provider`, `Appointment`, `BlockedDay`,
`Broadcast`, `SwapOffer`, `SwapRequest`) carries a `businessId` foreign key
plus an index on it.

Two independent ways a request resolves "which business":

| Context | Resolution | Where |
|---|---|---|
| Public / client routes (`/business/:slug/...`) | `slug` URL param → `resolveBusinessBySlug` middleware → `req.business` | `src/middleware/tenant.js` |
| Admin routes (`/business/...`, no slug) | JWT's `userId` → `getTargetBusinessId(ownerId)`, re-queried from the DB on every request | `src/controllers/business.js` |

The JWT itself only ever carries `{ userId, role }` — **never** a business ID.
Business ownership is always re-derived server-side, so a change in ownership
or role takes effect immediately without reissuing tokens.

Every admin write (update/delete) follows the same isolation pattern instead
of a single conditional:

```js
const existing = await prisma.service.findFirst({
  where: { id, businessId: req.business.id },
});
if (!existing) return res.status(404).json({ error: "..." });
// only now update/delete
```

This intentionally returns `404` — not `403` — when a record exists but
belongs to a different business, so a client can't distinguish "doesn't
exist" from "exists but isn't yours" and enumerate valid IDs across tenants.

---

## Project structure

```text
booking-app-backend/
├── app.js                      # entry point: middleware wiring, server start
├── prisma/
│   ├── schema.prisma            # data model
│   ├── migrations/              # versioned SQL migrations
│   └── seed.js                  # seeds two demo businesses for local dev
├── src/
│   ├── config/
│   │   ├── prisma.js             # Prisma client + pg driver adapter singleton
│   │   └── sms.js                # Twilio Verify wrapper, falls back to a
│   │                              # console-logged OTP when Twilio env vars
│   │                              # are unset (zero-config local dev)
│   ├── middleware/
│   │   ├── auth.js               # authenticateToken, requireAdmin
│   │   └── tenant.js             # resolveBusinessBySlug
│   ├── routes/                   # route definitions only — no logic
│   │   ├── mainRouters.js        # mounts auth/business/appointments/users
│   │   ├── auth.js
│   │   ├── business.js
│   │   ├── appointments.js
│   │   └── users.js
│   └── controllers/              # business logic lives here
│       ├── auth.js               # OTP send/verify, sliding-session refresh
│       ├── business.js           # services, staff, calendar, profile, stats
│       ├── appointment.js        # booking, cancellation, swap marketplace
│       └── users.js
└── package.json
```

---

## Getting started

### Prerequisites
- Node.js 18+
- A PostgreSQL database (this project is built against [Neon](https://neon.tech), serverless Postgres — any Postgres works)

### Install & run

```bash
npm install
cp .env.example .env     # fill in the values, see below
npx prisma migrate dev   # applies all migrations
node prisma/seed.js      # optional: seeds two demo businesses
npm run dev              # nodemon, auto-restarts on change
```

Server starts on `http://localhost:5000` by default.

### Without Twilio

Leave `TWILIO_*` unset in `.env` and the app transparently falls back to a
simulation mode: OTP codes are generated, stored in the `VerificationCode`
table, and printed to the console instead of sent via SMS — no Twilio account
needed for local development.

---

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | Server refuses to boot without it (`app.js` fails fast) |
| `PORT` | no | Defaults to `5000`; Render sets this automatically |
| `FRONTEND_URL` | no | Production frontend origin. If set, CORS locks to exactly this origin; if unset, CORS is open (local dev) |
| `TWILIO_ACCOUNT_SID` | no | Omit all three Twilio vars to use simulation mode |
| `TWILIO_AUTH_TOKEN` | no | |
| `TWILIO_VERIFY_SERVICE_SID` | no | |

---

## Data model

| Model | Purpose |
|---|---|
| `Business` | A tenant. Has a unique `slug`, an `ownerId`, booking-window settings |
| `User` | Phone-based identity, **business-agnostic** — one user can book at multiple businesses |
| `Provider` | A staff member of one business (name, optional image, optional description) |
| `Service` | A bookable service (name, price, duration) scoped to one business |
| `Appointment` | A booking: user + business + provider + service + time + status |
| `BlockedDay` | Admin-defined closures (full day or a time range), optionally per-provider |
| `SwapOffer` / `SwapRequest` | The peer-to-peer appointment-swap marketplace |
| `Broadcast` | Admin announcements shown to all of a business's clients |
| `Review` | Client ratings/comments on a business |
| `VerificationCode` | OTP codes for simulation-mode auth (unused when Twilio is configured) |

---

## API overview

Grouped by route file — see each controller for full request/response shapes.

**`/auth`** — phone OTP login
`POST /send-sms` · `POST /verify-sms` · `POST /refresh` (sliding session, see below)

**`/business`** — public routes are nested under `/business/:slug/...`
(profile, services, providers, settings, appointments, blocked-days, reviews,
active broadcasts); admin routes sit under `/business/...` and require
`authenticateToken` + `requireAdmin` (services/providers CRUD, calendar
management, weekly publish, broadcasts, stats, profile updates); onboarding
routes (`/business/register`, `/business/check-slug`) let an authenticated
user spin up a new tenant.

**`/appointments`** — booking (`POST /`), cancellation (`DELETE /:id`), "my
appointments" (`GET /my?businessId=`), and the swap marketplace
(`/swaps/available`, `/swaps/request`, `/swaps/requests`, approve/reject).

**`/users`** — profile updates, admin-only user listing.

---

## Notable design decisions

- **Sliding-session JWT refresh.** Rather than a fixed 30-day expiry from
  login, the frontend silently calls `POST /auth/refresh` on app load and on
  every window focus regain. Each refresh re-reads the user's *current* role
  from the database before reissuing the token — so a revoked admin role
  takes effect on the next refresh instead of waiting out a stale token. An
  actively-used device effectively never re-prompts for SMS; an
  abandoned/stolen one still expires within 30 days of last use.
- **In-memory rate limiting**, no Redis — a `Map` keyed by phone number, with
  separate limits on OTP send (3 / 10 min) and OTP verify attempts (5 / 5
  min). Deliberately simple for current scale.
- **Server-side enforcement duplicated from the client.** The weekly
  "publish" window that gates which dates are bookable was originally only a
  UI constraint — any date was bookable via a direct API call regardless of
  whether the business had published it. `createAppointment` now re-validates
  `bookingOpenUntil` server-side.
- **A race-condition safety net on booking**, not just an optimistic check: a
  partial unique index on `(providerId, dateTime)` at the DB level catches
  two simultaneous bookings for the same slot that both pass the initial
  `findFirst` conflict check before either write lands (Prisma error
  `P2002`, mapped to a clean `409`).

---

## Known limitations

Documented deliberately, not hidden:

- **No token revocation.** JWTs are stateless; there is no way to invalidate
  one specific compromised token early. The only "kill switch" is rotating
  `JWT_SECRET`, which logs out every user. Acceptable at current scale; the
  standard fix at larger scale is a short-lived access token + a
  server-tracked refresh token.
- **No automated test suite yet.** Correctness (including tenant isolation)
  has so far been verified manually. Test infrastructure is the top planned
  investment — see the frontend README for the same note.
- **No background job runner.** There is no reminder/notification system for
  upcoming appointments despite earlier UI copy implying one (removed once
  identified — see commit history).

---

## Deployment

Deployed on [Render](https://render.com) (free tier), auto-deploys on push to
`main`. Build command: `npm install` (the `postinstall` script runs
`prisma generate` automatically). Start command: `node app.js`.
