# StockAnalysis Dashboard — UI Design System

> Visual design system for the StockAnalysis dashboard (web + mobile-PWA).
> Inspired by Linear's design philosophy: **ultra-minimal, precise, dense
> but breathing**.

---

## 1. Design Principles

1. **Data-first, chrome-second.** The user is here for picks, scores, and
   outcomes — not for our brand. Every pixel of UI competes with content.
2. **Mobile is not a downgrade.** ~60% of retail-investor traffic is on
   phones during/after market hours. Mobile gets first-class layout
   (bottom-nav, large touch targets), not a stripped desktop view.
3. **PWA-installable.** "Add to Home Screen" on iOS Safari produces a
   full-screen, offline-capable app — no App Store needed for v1.
4. **Performance is design.** Sub-1s first paint on 4G, sub-200ms route
   change on Wi-Fi. CSS < 30KB, no framework, no build step.
5. **Accessibility is non-negotiable.** WCAG AA contrast (4.5:1 body,
   3:1 large text), 44×44px minimum touch targets, full keyboard nav.

---

## 2. Color System

Dark theme is primary. Light theme deferred to v2.

### Surface Palette (dark)

| Token | Hex | Usage |
|---|---|---|
| `--bg-primary` | `#08090A` | Page background (deepest) |
| `--bg-secondary` | `#0F1011` | Nav bar, sticky headers |
| `--bg-card` | `#151619` | Cards, table rows |
| `--bg-elevated` | `#1C1D20` | Hover, active state, modals |
| `--border` | `#23252A` | All dividers, card borders |
| `--border-strong` | `#34373D` | Input borders, focus rings (resting) |

### Text Palette

| Token | Hex | Contrast on bg-primary | Usage |
|---|---|---|---|
| `--text-primary` | `#E6E8EB` | 14.2:1 ✅ AAA | Body, headings |
| `--text-secondary` | `#9CA0A8` | 6.4:1 ✅ AA | Labels, captions |
| `--text-muted` | `#5F646D` | 3.8:1 ✅ AA-large | Disabled, hints |

### Accent Palette

| Token | Hex | Usage |
|---|---|---|
| `--accent` | `#5E6AD2` | Primary CTA, focus ring, links |
| `--accent-hover` | `#7480EE` | CTA hover |
| `--accent-soft` | `rgba(94,106,210,0.12)` | Selected row, badge bg |
| `--accent-glow` | `rgba(94,106,210,0.35)` | Focus ring outline |

### Semantic Palette (financial data)

| Token | Hex | Usage |
|---|---|---|
| `--success` | `#26C281` | Up, win, hit, Buy |
| `--success-bg` | `rgba(38,194,129,0.12)` | Pill bg |
| `--warning` | `#E5A93B` | Cautious Buy, watch tier |
| `--warning-bg` | `rgba(229,169,59,0.12)` | Pill bg |
| `--danger` | `#EB5757` | Down, loss, miss, Avoid |
| `--danger-bg` | `rgba(235,87,87,0.12)` | Pill bg |
| `--info` | `#5BA0F2` | Neutral data, links inside cards |

**Rules:**
- Never use raw hex in components. Always reference a token.
- Up/down indicators use `--success` / `--danger` *only*.
- Score badge uses `--success-bg`+`--success` (filled pill), never just
  colored text on default surface.

---

## 3. Typography

**Font stack:** `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

Inter loaded with `font-display: swap`. System fallback acceptable —
never block first paint waiting for Inter.

**Numbers:** `font-feature-settings: 'tnum' 1, 'cv11' 1;` (tabular
numerals + slashed-zero) on every element showing prices, scores, or
percentages so columns visually align.

### Type Scale (8px-rounded)

| Token | Size / Line | Weight | Usage |
|---|---|---|---|
| `--text-xs` | 11px / 16px | 500 | Labels, captions |
| `--text-sm` | 13px / 18px | 400 | Body, table cells |
| `--text-base` | 14px / 20px | 400 | Default body |
| `--text-md` | 15px / 22px | 500 | Emphasized body |
| `--text-lg` | 18px / 26px | 600 | Card titles |
| `--text-xl` | 22px / 30px | 600 | Page titles |
| `--text-2xl` | 28px / 36px | 600 | Big numbers (score) |
| `--text-3xl` | 36px / 42px | 700 | Hero / KPIs |

---

## 4. Spacing & Layout

**8px grid.** All spacing is a multiple of 4 or 8.

| Token | Value | Usage |
|---|---|---|
| `--space-1` | 4px | Inline gap |
| `--space-2` | 8px | Tight gap |
| `--space-3` | 12px | Compact components |
| `--space-4` | 16px | Card padding (mobile) |
| `--space-5` | 20px | Card padding (desktop) |
| `--space-6` | 24px | Section gap |
| `--space-8` | 32px | Page gutter (desktop) |

### Container

- **Desktop max width:** 1200px, centered, 24px gutter.
- **Mobile (<768px):** 100% width, 16px gutter.

---

## 5. Radius & Shadow

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 4px | Pills, badges |
| `--radius` | 8px | Cards, buttons, inputs |
| `--radius-lg` | 12px | Modals, hero cards |
| `--radius-pill` | 999px | Status pills |

Shadows minimal: `--shadow-sm: 0 1px 2px rgba(0,0,0,0.4)` for hover.

---

## 6. Layout Patterns

### Desktop App Shell
```
┌─ top nav (sticky, 56px) ──────────────────┐
│  Logo  Daily  Performance  Budget  System │  email · logout
├───────────────────────────────────────────┤
│   page content (max-w 1200, gutter 24)    │
└───────────────────────────────────────────┘
```

### Mobile App Shell (<768px)
```
┌─ top bar (52px) ──────────────────────────┐
│  📊  StockAnalysis              ⋯ logout  │
├───────────────────────────────────────────┤
│   page content (gutter 16)                │
├───────────────────────────────────────────┤
│  📊      📈      💰      ⚙️                │  ← bottom nav
│  Daily  Perf   Budget  System             │     (sticky, 64px)
└───────────────────────────────────────────┘
```

Bottom nav has 4 destinations (iOS HIG). Each tab min 56px tall, 44×44
touch target. Active tab uses `--accent` text + dot indicator.

---

## 7. Mobile-Specific Rules

1. **Touch targets ≥ 44×44px.** No exceptions.
2. **Bottom nav** (not hamburger). 4 tabs.
3. **Safe area insets** respected: `padding: env(safe-area-inset-*)`.
4. **No hover states on touch** — `@media (hover: hover)` guards hover.
5. **Tap highlight** disabled, replaced with explicit `:active` state.
6. **Numbers stay tabular** — never collapse a price into prose.

---

## 8. PWA

- `manifest.json`: standalone display, dark theme color, 192/512px icons.
- `apple-touch-icon` for iOS Add to Home Screen.
- Service worker: cache-first for static assets, network-first for API.

---

## 9. Accessibility

- **Contrast:** All text-on-bg combos pass WCAG AA.
- **Focus ring:** 2px solid `--accent`, 2px offset, never removed.
- **Reduced motion:** all transitions clamped to 0ms.
- **Screen reader:** every icon-only button has `aria-label`.

---

## 10. What Not To Do

- ❌ Inline styles in HTML (use tokens / classes)
- ❌ Hex colors anywhere outside `:root`
- ❌ Hamburger menu on mobile — bottom nav is the standard
- ❌ Loading spinners in tables — use skeleton rows
- ❌ Red/green text without an icon (colorblind users)
- ❌ Charts requiring hover to read values

---

*Owner: whoever changes the visual style is responsible for updating
this doc in the same PR.*
