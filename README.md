# 📊 StockAnalysis Dashboard

Read-only stock analysis dashboard powered by AI/ML — displays results from scheduled cloud functions without triggering any analysis jobs.

**🌐 Live: [kailunqian.github.io/stock-dashboard](https://kailunqian.github.io/stock-dashboard/)**

> Part of the [stock-ecosystem](https://github.com/kailunqian/stock-ecosystem) — see architecture, repo registry, and ADRs there.

## Features

### Pages

| Page | Description |
|------|-------------|
| **Daily** | Today's scan results: market regime, action buckets (High Conviction / Buy / Watch / Trim), top picks, and cross-sectional standouts |
| **Performance** | Prediction scorecard (7d/30d/all), confidence calibration, strategy leaderboard, and continuous recommendation portfolio / entry-monitor views |
| **Budget** | Admin-only Azure cost tracking: current spend vs $200 budget, forecast, and cost breakdown by service |
| **System** | Admin-only function health, incidents, scheduled jobs, ML buy-path health, ML activity, and model/self-test status |
| **Diagnostics** | Admin-only near-miss analysis, v2 shadow scoring diagnostics, and Model League shadow-health views |
| **Stock Detail** | Per-stock cached LLM signal, social sentiment, scan entry (read-only, no live scans) |

### Authentication

Magic-link email login — no passwords. The dashboard exchanges `#/verify?token=...` links for a `dash_jwt` auth cookie and also stores the returned bearer token as a fallback when third-party cookies are blocked.

- Rate limited: 3 login attempts per 15 min, 60 data requests per min (per IP)
- Unregistered emails never trigger sends
- CORS restricted to dashboard origin

## Architecture

```
┌────────────────────────┐      HTTPS/CORS       ┌───────────────────────────┐
│   GitHub Pages         │ ◄────────────────────► │   Azure Functions (Py)    │
│   (this repo)          │                        │   (private repo)          │
│                        │  cookie + bearer auth │                           │
│  • Vanilla JS SPA      │ ──────────────────────►│  • Dashboard/auth/        │
│  • Hash-based router   │                        │    billing/cache APIs     │
│  • Dark theme CSS      │  /api/dashboard/*      │  • Magic-link auth verify │
│  • Read-only views     │ ◄────────────────────► │  • Rate limiting          │
└────────────────────────┘                        └─────────┬─────────────────┘
                                                            │
                                                            ▼
                                                  ┌───────────────────┐
                                                  │  Azure Blob Store │
                                                  │                   │
                                                  │  • models/        │
                                                  │  • logs/          │
                                                  │  • performance/   │
                                                  │  • llm-signals/   │
                                                  │  • social-snaps/  │
                                                  └───────────────────┘
```

This repo contains **only the frontend** (HTML/CSS/JS). All ML models, strategies, and backend logic live in a private repository. The dashboard is **read-only** — it never triggers analysis jobs, preventing accidental cost spikes.

### Auth Flow

```
Email → Dashboard `#/verify?token=...` → `/api/auth/verify` → `dash_jwt` cookie (+ bearer fallback) → authenticated API calls
```

## Tech Stack

- **Frontend:** Vanilla JS SPA with hash-based routing (no framework dependencies)
- **Styling:** CSS custom properties dark theme (Linear/Vercel-inspired login, glassmorphism card, gradient accent, SVG icons)
- **Backend:** Azure Functions Python v2 (`/api/dashboard/*`, `/api/auth/*`, `/api/billing/*`, `/api/cache/*`)
- **Auth:** Azure Communication Services (magic-link email)
- **Data:** Azure Blob Storage (read-only)
- **Hosting:** GitHub Pages

## Design Choices

- **No frameworks** — fast, lightweight, easy to maintain
- **Dark theme** inspired by GitHub's dark mode
- **Login page** — glassmorphism card with gradient accent, SVG icons (no emoji)
- **Read-only dashboard** — all data comes from scheduled cloud functions
- **Self-healing** — auto-retry with known-fix patterns on function failures


## Development

### Cache-bust versioning

The service worker (`sw.js`) caches shell files keyed by `CACHE_VERSION`.
`index.html` and `sw.js` SHELL_FILES must reference the same `?v=` so the
SW invalidates the cache on deploy. CI guards against drift.

To bump the cache version:

1. Edit `CACHE_VERSION` in `sw.js` (e.g. `sa-v7.4`).
2. Run `node scripts/sync-cache-bust.mjs` to sync `?v=` everywhere.

To enable a local pre-push check (recommended):

```bash
git config core.hooksPath .githooks
```
