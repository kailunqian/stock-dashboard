# 📊 StockAnalysis Dashboard

Real-time stock analysis visualization dashboard powered by AI/ML.

**🌐 Live: [kailunqian.github.io/stock-dashboard](https://kailunqian.github.io/stock-dashboard/)**

## Features

- **Daily Report** — Today's top stock picks with scores, targets, and signals
- **Performance Scorecard** — Track recommendation accuracy (7d/30d/all-time), alpha vs SPY
- **Stock Detail** — Decision flow visualization showing how each score is computed (technical, fundamental, momentum, news weights)
- **Budget Monitor** — Azure cost tracking with forecasts
- **System Health** — ML model status, function health, self-test results

## Authentication

Login via magic-link email — no passwords needed. Authorized emails receive a one-click login link.

## Architecture

```
┌─────────────────────┐       HTTPS/CORS       ┌──────────────────────┐
│   GitHub Pages      │ ◄──────────────────────►│  Azure Functions     │
│   (this repo)       │                         │  (private repo)      │
│                     │                         │                      │
│  • index.html       │   /api/dashboard/*      │  • ML scoring engine │
│  • SPA router       │ ◄──────────────────────►│  • 72-feature model  │
│  • Dark theme UI    │                         │  • Social sentiment  │
│  • Decision flow    │                         │  • Performance track │
└─────────────────────┘                         └──────────────────────┘
```

This repo contains **only the frontend** (HTML/CSS/JS). All ML models, strategies, and backend logic live in a private repository.

## Tech Stack

- Vanilla JS SPA (no framework dependencies)
- CSS custom properties dark theme
- Azure Functions API backend
- Azure Communication Services (magic-link auth)
