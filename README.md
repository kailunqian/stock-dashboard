# 📊 StockAnalysis Dashboard

Read-only stock analysis dashboard powered by AI/ML — displays results from scheduled cloud functions without triggering any analysis jobs.

**🌐 Live: [kailunqian.github.io/stock-dashboard](https://kailunqian.github.io/stock-dashboard/)**

## Features

### Pages

| Page | Description |
|------|-------------|
| **Daily** | Today's scan results: stocks scanned, buy signals, top picks with scores/targets/signals, training status card (budget tier & headroom), ML model accuracy |
| **Performance** | ML model metrics (accuracy, AUC-ROC, scorer hit rate, training samples), prediction scorecard (7d/30d/all), confidence calibration |
| **Budget** | Azure cost tracking: current spend vs $200 budget, month-end forecast, cost breakdown by service |
| **System** | Function health status (daily_scan, daily_retrain, hourly_monitor, outcome_tracker, self_test, cost_check), ML model info (version, features, accuracy, data sources), self-test results |
| **Stock Detail** | Per-stock cached LLM signal, social sentiment, scan entry (read-only, no live scans) |

### Authentication

Magic-link email login — no passwords. Azure Communication Services sends one-click login links to authorized emails. Token-based auth with Bearer headers on all API calls.

- Rate limited: 3 login attempts per 15 min, 60 data requests per min (per IP)
- Unregistered emails never trigger sends
- CORS restricted to dashboard origin

## Architecture

```
┌────────────────────────┐      HTTPS/CORS       ┌───────────────────────────┐
│   GitHub Pages         │ ◄────────────────────► │   Azure Functions (Py)    │
│   (this repo)          │                        │   (private repo)          │
│                        │  Bearer token auth     │                           │
│  • Vanilla JS SPA      │ ──────────────────────►│  • 9 dashboard API routes │
│  • Hash-based router   │                        │  • Magic-link auth verify │
│  • Dark theme CSS      │  /api/dashboard/*      │  • Rate limiting          │
│  • Read-only views     │ ◄────────────────────► │  • Self-healing retries   │
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
Email → Azure Functions (send magic link) → User clicks link → Verify token → Redirect with session token → Bearer auth
```

## Tech Stack

- **Frontend:** Vanilla JS SPA with hash-based routing (no framework dependencies)
- **Styling:** CSS custom properties dark theme (Linear/Vercel-inspired login, glassmorphism card, gradient accent, SVG icons)
- **Backend:** Azure Functions Python v2 (9 dashboard API endpoints)
- **Auth:** Azure Communication Services (magic-link email)
- **Data:** Azure Blob Storage (read-only)
- **Hosting:** GitHub Pages

## Design Choices

- **No frameworks** — fast, lightweight, easy to maintain
- **Dark theme** inspired by GitHub's dark mode
- **Login page** — glassmorphism card with gradient accent, SVG icons (no emoji)
- **Read-only dashboard** — all data comes from scheduled cloud functions
- **Self-healing** — auto-retry with known-fix patterns on function failures
