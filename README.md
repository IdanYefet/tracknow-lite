# TrackNow-Lite

A small affiliate tracking + support-ticket simulator, built to explore the
core mechanics behind affiliate-tracking platforms: issuing tracking links,
receiving conversion webhooks from a merchant's site, and handling the
integration failures that come up along the way.

Built with **zero external dependencies** — just Node's built-in `http`
server and its built-in `node:sqlite` module — so it runs immediately with
no `npm install` step.

## Why this project

Built while preparing for Customer Success Engineer roles at
affiliate-tracking / martech companies. The goal was to actually understand,
hands-on, the three things those roles keep coming back to:

- **Integrations** — how a tracking link and a webhook actually work end to end
- **Troubleshooting** — what it looks like when an integration is *broken*, not just when it works
- **CRM/ticketing systems** — how a failure should turn into a trackable, assignable support ticket instead of a silent drop

## What it does

1. **Register a click** — `POST /api/clicks` simulates a user clicking an
   affiliate's tracking link. It generates a unique `tracking_id` and returns
   a redirect URL with that ID attached, exactly like a real tracking pixel/link would.

2. **Receive a conversion webhook** — `POST /api/webhook/conversion`
   simulates the merchant's site calling back when a sale happens.
   - If the `tracking_id` matches a known click, the conversion is recorded
     and shows up in the affiliate's stats.
   - If the `tracking_id` is unrecognized (expired click, broken tracking
     script, tampered parameter — all real integration failure modes), the
     system doesn't just fail silently. It **automatically opens a
     high-priority support ticket** describing the likely cause, so a
     Customer Success Engineer can follow up with the client.

3. **Affiliate performance dashboard** — `GET /api/stats` aggregates clicks,
   conversions, conversion rate, and revenue per affiliate.

4. **Support ticket queue** — `GET /api/tickets` and
   `PATCH /api/tickets/:id` let you view and update ticket status
   (open → in_progress → resolved), the same lifecycle a Zendesk/Intercom
   ticket would follow.

A minimal dashboard (`public/index.html`) lets you trigger clicks and
webhooks by hand and watch the stats/tickets tables update live.

## Getting started

```bash
node --version   # requires Node 22+ (for the built-in node:sqlite module)

npm run seed     # creates the SQLite DB and adds 3 sample affiliates
npm start         # starts the server at http://localhost:3000
```

Then open `http://localhost:3000` in a browser.

## Testing the API with Postman

`postman_collection.json` is included — import it into Postman to hit every
endpoint without touching the UI. It includes a request that intentionally
sends an unknown `tracking_id`, so you can see the auto-ticket-creation
behavior directly.

## API reference

| Method | Route                        | Description                                   |
|--------|-------------------------------|------------------------------------------------|
| GET    | `/api/affiliates`             | List affiliates                                |
| POST   | `/api/clicks`                 | Register a click, get back a `tracking_id`     |
| POST   | `/api/webhook/conversion`     | Simulate a merchant's conversion webhook       |
| GET    | `/api/stats`                  | Per-affiliate clicks/conversions/revenue       |
| GET    | `/api/tickets`                | List support tickets                           |
| PATCH  | `/api/tickets/:id`             | Update a ticket's status                       |

## Project structure

```
tracknow-lite/
├── server.js              # HTTP server + routing (no framework)
├── db/
│   ├── database.js        # SQLite schema (clicks, conversions, tickets, affiliates)
│   └── seed.js             # Sample affiliate data
├── public/
│   └── index.html          # Dashboard UI
├── postman_collection.json
└── README.md
```

## Possible next steps

- Add authentication for the affiliate/admin views
- Add email notifications when a high-priority ticket is created
- Swap `node:sqlite` for Postgres for a multi-user deployment
- Add a `/api/redirect/:tracking_id` route that does a real HTTP redirect, to simulate the full click → redirect → merchant-site flow
