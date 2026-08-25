# TinyCare

TinyCare is a mobile-first baby care tracker for feeds, diapers, sleep,
medications, and family routines. It is designed for quick one-handed logging,
shared parent visibility, and doctor-friendly exports.

## Features

- Bottle sessions with a start confirmation, one-hour formula discard timer,
  editable in-progress start time, and mL/oz completion entry
- Diaper, sleep, and medication logging
- Medication favorites and iPhone-style share-sheet messages after logging
- Planned and recurring task support
- Timeline, calendar, and log views
- Local browser timers for formula discard and next feed reminders
- Optional family access code gate
- CSV/HTML export support

## Privacy Model

This repository is a generic template. It should not contain real baby records,
family names, access codes, API keys, or deployment IDs.

Keep private data out of source control:

- Store real records only in your runtime database.
- Store access codes and tokens in environment variables.
- Do not commit `.env.local`, production secrets, or hosting project IDs.
- Do not seed migrations with real hospital or family records.

## Tech Stack

- Next.js / React
- Vinext for Cloudflare Worker-style deployment
- Cloudflare D1-compatible database access
- Drizzle migrations
- Tailwind CSS

## Getting Started

Requirements:

- Node.js `>=22.13.0`
- npm

Install dependencies:

```sh
npm install
```

Copy the example environment file if you want local secrets:

```sh
cp .env.example .env.local
```

Run the app:

```sh
npm run dev
```

Build:

```sh
npm run build
```

## Environment Variables

| Variable | Required | Purpose |
|---|---:|---|
| `BABY_TRACKER_ACCESS_CODE` | No | Optional family code shown on the unlock screen |
| `BABY_TRACKER_ACCESS_TOKEN` | No | Cookie token paired with the family code |

If either access variable is omitted, the access-code gate is disabled.

## Database

The app expects a D1-compatible binding named `DB` in the hosting environment.
Migrations live in `drizzle/`. The public template includes schema migrations
only; it intentionally does not seed private baby records.

The included `.openai/hosting.json` is a sanitized template with an empty
`project_id`. Do not replace it with a live private project ID in a public repo.

## Open Source Notes

Suggested repository:

- Name: `tinycare`
- License: MIT
- Description: `A mobile-first baby care tracker for feeds, diapers, sleep, medications, and family routines.`

Before publishing your own fork, run a privacy scan for names, emails, access
codes, URLs, and real event data.
