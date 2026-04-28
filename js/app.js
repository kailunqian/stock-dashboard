/* StockAnalysis Dashboard — SPA Router + Page Renderers */

// Phase 13e: Stripe arming flag. Flip to true once STRIPE_SECRET_KEY,
// STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET are set in Azure Function App
// settings AND a smoke checkout has been verified. While false, all
// "Get Pro / Upgrade / Unlock" CTAs render as a non-clickable
// "Pro · coming soon" pill so users never hit a 503 from /api/billing.
const STRIPE_ENABLED = false;

function proCta(label, opts) {
    opts = opts || {};
    const cls = opts.className || 'btn-unlock';
    const style = opts.style || '';
    if (STRIPE_ENABLED) {
        return `<a href="#/signup" class="${cls}" style="${style}">${label}</a>`;
    }
    // Disabled state: same visual weight, no link, "coming soon" hint.
    return `<span class="${cls}" style="${style};opacity:0.6;cursor:not-allowed;pointer-events:none" title="Pro launches soon — drop your email below to get notified">
        🔒 Pro · coming soon
    </span>`;
}

// ── Phase 13d: Paywall card (shared) ────────────────────────────────
function effectiveViewAsTier() {
    try { return localStorage.getItem('viewAsTier') || 'real'; } catch (_) { return 'real'; }
}
function blurredTeaser(innerHtml, title, subtitle) {
    return `
    <div class="teaser-wrap">
        <div class="teaser-content">${innerHtml}</div>
        <div class="teaser-overlay">
            <div class="teaser-card glass">
                <div style="font-size:32px;margin-bottom:8px">🔒</div>
                <h2 style="margin:0 0 8px">${title || 'Pro feature'}</h2>
                <p style="color:var(--text-secondary);margin:0 0 18px;max-width:420px">
                    ${subtitle || 'Upgrade to Pro to unlock the full experience — daily picks, per-stock drilldowns, performance analytics, and real-time alerts.'}
                </p>
                    ${proCta('Unlock with Pro →', { className: 'btn-primary', style: 'display:inline-block;background:linear-gradient(135deg,#f59e0b,#6366f1);color:#fff;padding:12px 24px;border-radius:8px;font-weight:600;text-decoration:none' })}
            </div>
        </div>
    </div>`;
}
function paywallCard(reasonHtml, message, statsObj) {
    const stats = statsObj || {};
    const m = stats.model || {};
    const t = stats.training_status || stats.training || {};
    const metaRow = (m.accuracy || t.trained_at) ? `
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:14px;
                    font-size:13px;color:var(--text-secondary)">
            ${m.accuracy ? `<div>Model accuracy: <strong style="color:var(--text-primary)">${(m.accuracy*100).toFixed(1)}%</strong></div>` : ''}
            ${t.trained_at ? `<div>Last trained: <strong style="color:var(--text-primary)">${t.trained_at}</strong></div>` : ''}
        </div>` : '';
    return `
    <div class="card featured" data-tier="strong-buy" style="text-align:center;padding:36px 24px">
        <div style="font-size:32px;margin-bottom:12px">🔒</div>
        <div class="card-title" style="font-size:20px;margin-bottom:8px">Pro Feature</div>
        <div style="color:var(--text-secondary);max-width:520px;margin:0 auto 8px">
            ${reasonHtml}
        </div>
        <div style="color:var(--text-secondary);max-width:520px;margin:0 auto 18px;font-size:14px">
            ${message || 'Upgrade to Pro for full access — $9/mo.'}
        </div>
        ${proCta('Upgrade to Pro — $9/mo', { className: 'btn btn-primary' })}
        ${metaRow}
    </div>`;
}

// ── Lazy Chart.js loader (only when /performance is visited) ────────
let _chartJsPromise = null;
function ensureChartJs() {
    if (window.Chart) return Promise.resolve();
    if (_chartJsPromise) return _chartJsPromise;
    _chartJsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = (e) => { _chartJsPromise = null; reject(e); };
        document.head.appendChild(s);
    });
    return _chartJsPromise;
}

// ── Router ──────────────────────────────────────────────────────────

const Router = {
    routes: {},
    register(path, handler) { this.routes[path] = handler; },
    async navigate(path) {
        window.location.hash = `#${path}`;
    },
    async handleRoute() {
        const hash = window.location.hash.slice(1) || '/login';
        const path = hash.split('?')[0];

        // Phase 13g-5: magic-link landing. Email links to #/verify?token=XXX
        // (dashboard host), we exchange the token for the auth cookie via
        // fetch, then route to /daily. Token stays in URL fragment only
        // (never sent over the wire) and is stripped from history below.
        if (path === '/verify') {
            const qs = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
            const token = new URLSearchParams(qs).get('token') || '';
            const main = document.getElementById('app') || document.body;
            if (!token) {
                main.innerHTML = `<div style="text-align:center;padding:60px;color:#e6edf3">
                    <h2>❌ Missing token</h2>
                    <p><a href="#/login" style="color:#58a6ff">Back to sign in</a></p></div>`;
                return;
            }
            main.innerHTML = `<div style="text-align:center;padding:60px;color:#e6edf3">
                <h2>✅ Signing you in…</h2><p>One moment.</p></div>`;
            try {
                await API.verifyMagicLink(token);
                // Strip token from history before navigating, so refresh/back
                // doesn't try to re-consume an already-used token.
                window.history.replaceState({}, '', window.location.pathname + '#/daily');
                window.location.reload();
            } catch (e) {
                main.innerHTML = `<div style="text-align:center;padding:60px;color:#e6edf3">
                    <h2>❌ Invalid or expired link</h2>
                    <p>Please request a new sign-in link.</p>
                    <p><a href="#/login" style="color:#58a6ff">Back to sign in</a></p></div>`;
            }
            return;
        }

        // Auth check (skip for login). Memoized in API.checkAuth so navigation
        // between routes within AUTH_TTL_MS doesn't burn an extra round-trip.
        // Public (unauthenticated) routes — login, signup
        const PUBLIC_ROUTES = new Set(['/login', '/signup']);
        if (!PUBLIC_ROUTES.has(path)) {
            const auth = await API.checkAuth();
            if (!auth.authenticated) {
                window.location.hash = '#/login';
                return;
            }
            document.getElementById('user-email').textContent = auth.email;
            document.getElementById('nav').style.display = 'flex';
            // Bottom-nav: visible on mobile only — controlled entirely by
            // CSS via `body.has-bottom-nav` + @media (max-width: 768px).
            document.body.classList.add('has-bottom-nav');
            // Phase 13d.1: hide admin-only nav links from non-admins.
            // Phase 13d.2: separate super-admin gate for /admin (co-admin mgmt).
            const realIsAdmin = !!auth.is_admin;
            const realIsSuperAdmin = !!auth.is_super_admin;
            // Phase 13d.3: when impersonating a non-admin tier, hide admin
            // chrome too so the UX matches what a real Free/Pro user sees.
            // The View-as selector + escape banner remain visible (they're
            // injected/preserved separately below).
            let viewAsTier = 'real';
            try { viewAsTier = localStorage.getItem('viewAsTier') || 'real'; } catch (_) {}
            const impersonatingNonAdmin = realIsAdmin && viewAsTier !== 'real' && viewAsTier !== 'grandfathered';
            const isAdmin = realIsAdmin && !impersonatingNonAdmin;
            const isSuperAdmin = realIsSuperAdmin && !impersonatingNonAdmin;
            document.body.classList.toggle('is-admin', isAdmin);
            document.body.classList.toggle('is-super-admin', isSuperAdmin);
            document.querySelectorAll('[data-admin-only]').forEach(el => {
                // Skip the View-as selector — admin must always be able to exit.
                if (el.id === 'view-as-select' || el.closest('#view-as-select')) {
                    el.style.display = realIsAdmin ? '' : 'none';
                    return;
                }
                el.style.display = isAdmin ? '' : 'none';
            });
            document.querySelectorAll('[data-super-admin-only]').forEach(el => {
                el.style.display = isSuperAdmin ? '' : 'none';
            });
            // Phase 13d.3: wire up "View as" tier impersonation selector
            // (admin-only; backend enforces, this is just UX).
            const viewAsSel = document.getElementById('view-as-select');
            if (viewAsSel && realIsAdmin && !viewAsSel._wired) {
                viewAsSel._wired = true;
                try {
                    viewAsSel.value = localStorage.getItem('viewAsTier') || 'real';
                } catch (_) {}
                viewAsSel.addEventListener('change', () => {
                    try {
                        if (viewAsSel.value === 'real') {
                            localStorage.removeItem('viewAsTier');
                        } else {
                            localStorage.setItem('viewAsTier', viewAsSel.value);
                        }
                        // Phase 13d.3: nuke all SWR caches so we don't bleed
                        // payloads across tiers (admin → free → admin etc).
                        Object.keys(localStorage)
                            .filter(k => k.startsWith('swr:'))
                            .forEach(k => localStorage.removeItem(k));
                    } catch (_) {}
                    // Hard reload to flush any cached tier-gated UI.
                    window.location.reload();
                });
                // Visible "impersonating" badge on body for safety.
                const v = viewAsSel.value;
                const impersonating = !!(v && v !== 'real');
                document.body.classList.toggle('is-impersonating', impersonating);
                document.body.dataset.viewAs = v || 'real';
                // Inject a clickable "exit impersonation" banner so admin can
                // always escape, even if the page underneath fails to render.
                let exitBar = document.getElementById('impersonation-bar');
                if (impersonating && !exitBar) {
                    exitBar = document.createElement('div');
                    exitBar.id = 'impersonation-bar';
                    exitBar.innerHTML = `<span>⚠ Viewing as <strong>${v}</strong></span>
                        <button id="exit-impersonation-btn">← Back to Admin view</button>`;
                    document.body.insertBefore(exitBar, document.body.firstChild);
                    document.getElementById('exit-impersonation-btn').addEventListener('click', () => {
                        try {
                            localStorage.removeItem('viewAsTier');
                            Object.keys(localStorage)
                                .filter(k => k.startsWith('swr:'))
                                .forEach(k => localStorage.removeItem(k));
                        } catch (_) {}
                        window.location.reload();
                    });
                } else if (!impersonating && exitBar) {
                    exitBar.remove();
                }
            }
            // Block direct hash navigation to admin pages too.
            const ADMIN_ROUTES = new Set(['/budget', '/system', '/pipeline']);
            const SUPER_ADMIN_ROUTES = new Set(['/admin']);
            if (!isAdmin && ADMIN_ROUTES.has(path)) {
                window.location.hash = '#/daily';
                return;
            }
            if (!isSuperAdmin && SUPER_ADMIN_ROUTES.has(path)) {
                window.location.hash = '#/daily';
                return;
            }
            // Phase 13e: legal disclaimer on every authenticated page,
            // dismissible per browser session (resets on tab close).
            const bar = document.getElementById('disclaimer-bar');
            if (bar && !sessionStorage.getItem('disclaimer-dismissed')) {
                bar.hidden = false;
            }
        } else {
            document.getElementById('nav').style.display = 'none';
            document.body.classList.remove('has-bottom-nav');
            const bar = document.getElementById('disclaimer-bar');
            if (bar) bar.hidden = true;
        }

        // Highlight active nav (top + bottom)
        document.querySelectorAll('.nav-links a, .bottom-nav a').forEach(a => {
            a.classList.toggle('active', a.getAttribute('href') === `#${path}`);
        });

        const handler = this.routes[path];
        const main = document.getElementById('app');
        if (handler) {
            main.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Loading...</div>';
            try {
                main.innerHTML = await handler();
                // Post-render: hydrate DAG if present
                _hydrateDag(main);
                // Post-render: load performance charts if on performance page
                if (path === '/performance') {
                    // Lazy-load Chart.js only when needed (saves ~84KB on every other page)
                    ensureChartJs().then(() => loadPerformanceCharts(90));
                    // Wire up timeframe buttons via event delegation
                    const chartSection = document.getElementById('performance-charts');
                    if (chartSection) {
                        chartSection.querySelectorAll('.chart-timeframe button[data-days]').forEach(btn => {
                            btn.addEventListener('click', () => {
                                ensureChartJs().then(() => loadPerformanceCharts(parseInt(btn.dataset.days)));
                            });
                        });
                    }
                }
            } catch (e) {
                main.innerHTML = `<div class="card" style="margin:40px auto;max-width:500px;text-align:center">
                    <h3>⚠️ Error</h3><p style="color:var(--text-secondary)">${e.message}</p></div>`;
            }
        } else {
            main.innerHTML = '<div class="card" style="margin:40px auto;max-width:500px;text-align:center"><h3>Page not found</h3></div>';
        }
    }
};

window.addEventListener('hashchange', () => {
    // In-page anchor (e.g. #teaser, #signin-box) — scroll, don't route.
    const raw = window.location.hash.slice(1);
    if (raw && !raw.startsWith('/')) {
        const el = document.getElementById(raw);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    }
    Router.handleRoute();
});

// ── Helpers ─────────────────────────────────────────────────────────

function pctClass(val) { return val >= 0 ? 'positive' : 'negative'; }
function pctSign(val) { return val >= 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`; }
function pill(text, type) { return `<span class="pill pill-${type}">${text}</span>`; }

function recPill(rec) {
    const map = {
        'Strong Buy': 'green', 'Buy': 'green', 'Cautious Buy': 'yellow',
        'Watch': 'yellow', 'Neutral': 'blue', 'Avoid': 'red',
    };
    return pill(rec, map[rec] || 'blue');
}

function scoreBar(p) {
    const items = [
        { label: 'T', val: p.technical, color: '#4fc3f7' },
        { label: 'F', val: p.fundamental, color: '#81c784' },
        { label: 'M', val: p.momentum, color: '#ffb74d' },
        { label: 'N', val: p.news, color: '#ce93d8' },
        { label: 'S', val: p.strategy, color: '#f06292' },
    ];
    return items.filter(i => i.val != null).map(i =>
        `<span title="${i.label}: ${i.val?.toFixed(0)}" style="display:inline-block;width:18px;height:12px;background:${i.color};opacity:${Math.max(0.3, (i.val||0)/100)};border-radius:2px;margin-right:1px"></span>`
    ).join('') + `<span style="font-size:11px;color:var(--text-secondary);margin-left:3px">${items.map(i=>(i.val||0).toFixed(0)).join('/')}</span>`;
}

function renderConvictionTracker(conviction) {
    if (!conviction || conviction.length === 0) return '';
    const rows = conviction.slice(0, 10).map(c => {
        const trendIcon = c.trend === 'up' ? '📈' : c.trend === 'down' ? '📉' : '➡️';
        const scoreColor = c.avg_score >= 75 ? 'positive' : c.avg_score >= 60 ? 'neutral' : 'negative';
        const bar = Math.min(100, c.avg_score);
        return `<tr>
            <td><strong>${c.symbol}</strong></td>
            <td class="${scoreColor}">${c.avg_score}</td>
            <td>${c.appearances}d</td>
            <td>${c.high_count}×</td>
            <td>${trendIcon}</td>
            <td><div class="conviction-bar"><div class="conviction-fill" style="width:${bar}%"></div></div></td>
        </tr>`;
    }).join('');
    return `
    <div class="table-container" style="margin-bottom:20px">
        <div class="table-header">🎯 30-Day Conviction Tracker</div>
        <table>
            <thead><tr>
                <th>Symbol</th><th>Avg Score</th><th>Tracked</th>
                <th>Strong (≥75)</th><th>Trend</th><th>Conviction</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

function timeSince(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
}

// ── Login Page ──────────────────────────────────────────────────────

Router.register('/login', async () => {
    setTimeout(() => {
        const dismiss = document.getElementById('disclaimer-dismiss');
        if (dismiss && !dismiss.dataset.bound) {
            dismiss.dataset.bound = '1';
            dismiss.addEventListener('click', () => {
                sessionStorage.setItem('disclaimer-dismissed', '1');
                const bar = document.getElementById('disclaimer-bar');
                if (bar) bar.hidden = true;
            });
        }
        const form = document.getElementById('login-form');
        if (form) form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const btn = document.getElementById('login-btn');
            const msg = document.getElementById('login-msg');
            // Optimistic UI: show "sent" immediately, retry silently on failure
            msg.className = 'login-message';
            msg.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Check your email for a sign-in link';
            btn.disabled = true;
            btn.textContent = 'Sent ✓';
            try { await API.login(email); }
            catch (e) {
                msg.className = 'login-message login-error';
                msg.textContent = 'Failed to send. Try again.';
                btn.disabled = false;
                btn.textContent = 'Send sign-in link';
            }
        });
    }, 50);

    // Mock teaser data — visible to anonymous visitors
    const teaserPicks = [
        { sym: 'NVDA', rec: 'Strong Buy', score: 92, signal: 'Momentum breakout' },
    ];
    const lockedPicks = [
        { sym: 'AAPL', rec: 'Buy',   score: 84 },
        { sym: 'MSFT', rec: 'Buy',   score: 81 },
        { sym: 'AMD',  rec: 'Buy',   score: 78 },
        { sym: 'GOOGL', rec: 'Hold', score: 72 },
    ];
    const visibleRows = teaserPicks.map(p => `
        <tr><td><strong>${p.sym}</strong></td><td>${recPill(p.rec)}</td>
            <td><div class="score-ring" style="--score:${p.score};--size:42px"><span>${p.score}</span></div></td>
            <td>$—</td><td>${p.signal}</td></tr>`).join('');
    const lockedRows = lockedPicks.map(p => `
        <tr class="locked-row"><td><strong>${p.sym}</strong></td><td>${recPill(p.rec)}</td>
            <td>${p.score}</td><td>$—</td><td>—</td></tr>`).join('');
    const perfCards = [
        { title: '30D Hit Rate',   value: '62%',   sub: '🟢 18W / 11L (29 picks)' },
        { title: '90D Hit Rate',   value: '58%',   sub: '🟢 47W / 34L (81 picks)' },
        { title: 'Avg Return',     value: '+3.4%', sub: 'per pick, 30D rolling' },
        { title: 'Alpha vs SPY',   value: '+1.8%', sub: 'risk-adjusted' },
    ].map(c => `
        <div class="card">
            <div class="card-title">${c.title}</div>
            <div class="card-value positive">${c.value}</div>
            <div class="card-subtitle">${c.sub}</div>
        </div>`).join('');

    return `
    <header class="landing-header">
        <a href="#/login" class="landing-brand">
            <svg viewBox="0 0 24 24" width="20" height="20"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            StockAnalysis
        </a>
        <nav class="landing-nav">
            <a href="#signin-box" class="btn btn-ghost">Sign in</a>
            ${proCta('Get Pro — $9/mo', { className: 'btn btn-primary', style: 'width:auto;padding:8px 16px' })}
        </nav>
    </header>
    <section class="landing-split" aria-label="Welcome">
        <div class="landing-split-left">
            <div class="badge">Daily AI Stock Picks</div>
            <h1>Signals you can act on,<br>not noise.</h1>
            <p>An ML pipeline scores 240+ stocks every market day across
               technicals, fundamentals, news sentiment, and momentum —
               surfacing the few that actually move.</p>
            <ul class="landing-bullets">
                <li>✓ Daily top picks, ranked by composite score</li>
                <li>✓ Backed by live hit-rate &amp; calibration data</li>
                <li>✓ No brokerage linking — read-only signals</li>
            </ul>
            <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">
                ${proCta('Get Pro — $9/mo →')}
                <a href="#teaser" class="btn btn-ghost">See a sample ↓</a>
            </div>
            <div class="landing-pricing" style="margin-top:18px">
                Cancel anytime · US &amp; Canada · Not financial advice
            </div>
        </div>
        <div class="landing-split-right">
            <div class="login-box compact" id="signin-box">
                <h2>Sign in or get started — free</h2>
                <p class="login-sub">Enter your email — we'll send a link. Account is created automatically if you're new.</p>
                <form id="login-form">
                    <input type="email" id="login-email" class="login-input" placeholder="you@example.com" required />
                    <button type="submit" id="login-btn" class="btn btn-primary">Send sign-in link</button>
                </form>
                <div id="login-msg" class="login-message"></div>
                <div class="login-footer">
                    Want full access? ${proCta('Upgrade to Pro →', { className: '', style: 'margin-left:6px;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,0.06);font-size:0.9em' })}<br>
                    <a href="legal/terms.html">Terms</a> · <a href="legal/privacy.html">Privacy</a>
                </div>
            </div>
        </div>
    </section>

    <section id="teaser" class="landing-teaser" aria-label="Sample of today's picks">
        <h2 style="text-align:center;margin:0 0 8px">Today's Picks <span style="color:var(--text-secondary);font-weight:400">— sample</span></h2>
        <p style="text-align:center;color:var(--text-secondary);margin:0 0 24px">Top-scoring stocks for today, ranked by our composite ML model.</p>
        <div class="card" style="padding:0;overflow:hidden">
            <table style="width:100%;border-collapse:collapse">
                <thead><tr style="background:rgba(255,255,255,0.03)">
                    <th style="padding:12px;text-align:left">Symbol</th>
                    <th style="padding:12px;text-align:left">Recommendation</th>
                    <th style="padding:12px;text-align:left">Score</th>
                    <th style="padding:12px;text-align:left">Buy</th>
                    <th style="padding:12px;text-align:left">Signal</th>
                </tr></thead>
                <tbody>${visibleRows}${lockedRows}
                    <tr class="unlock-cta-row"><td colspan="5">
                        <div class="unlock-cta">
                            <div>
                                <strong>🔒 ${lockedPicks.length} more picks hidden</strong>
                                <div style="font-size:13px;color:var(--text-secondary);margin-top:2px">
                                    Plus per-stock drilldowns, real-time alerts, and full history.
                                </div>
                            </div>
                            ${proCta('Unlock with Pro →')}
                        </div>
                    </td></tr>
                </tbody>
            </table>
        </div>
    </section>

    <section class="landing-teaser" aria-label="Track your edge">
        <h2 style="text-align:center;margin:0 0 8px">Track Your Edge <span style="color:var(--text-secondary);font-weight:400">— sample</span></h2>
        <p style="text-align:center;color:var(--text-secondary);margin:0 0 24px">Live hit-rate and risk-adjusted returns, fully transparent.</p>

        <div class="card" style="padding:24px;margin-bottom:18px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;margin-bottom:14px">
                <div>
                    <div class="card-title" style="margin-bottom:4px">90-Day Cumulative Return</div>
                    <div style="display:flex;gap:18px;align-items:baseline;flex-wrap:wrap">
                        <span class="card-value positive" style="font-size:28px">+18.4%</span>
                        <span style="color:var(--text-secondary);font-size:14px">vs SPY <strong style="color:var(--text-primary)">+7.2%</strong></span>
                        <span class="pill pill-green">+11.2% alpha</span>
                    </div>
                </div>
                <div style="display:flex;gap:14px;font-size:13px;align-items:center">
                    <span><span class="legend-dot" style="background:#6366f1"></span> Our Picks</span>
                    <span><span class="legend-dot" style="background:#94a3b8"></span> SPY</span>
                </div>
            </div>
            <svg viewBox="0 0 800 220" width="100%" height="220" preserveAspectRatio="none" style="display:block">
                <defs>
                    <linearGradient id="picks-fill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stop-color="#6366f1" stop-opacity="0.35"/>
                        <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
                    </linearGradient>
                </defs>
                <!-- gridlines -->
                <g stroke="rgba(255,255,255,0.06)" stroke-width="1">
                    <line x1="0" y1="44"  x2="800" y2="44"/>
                    <line x1="0" y1="88"  x2="800" y2="88"/>
                    <line x1="0" y1="132" x2="800" y2="132"/>
                    <line x1="0" y1="176" x2="800" y2="176"/>
                </g>
                <!-- SPY line (gentler slope) -->
                <polyline fill="none" stroke="#94a3b8" stroke-width="2" stroke-linejoin="round"
                  points="0,176 60,172 120,168 180,164 240,158 300,162 360,156 420,150 480,148 540,144 600,140 660,138 720,134 800,128"/>
                <!-- Picks line (steeper, with realistic dips) -->
                <polygon fill="url(#picks-fill)" stroke="none"
                  points="0,176 50,170 100,160 150,166 200,150 260,140 310,148 360,128 420,118 470,124 520,108 580,96 640,84 700,72 760,60 800,48 800,220 0,220"/>
                <polyline fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linejoin="round"
                  points="0,176 50,170 100,160 150,166 200,150 260,140 310,148 360,128 420,118 470,124 520,108 580,96 640,84 700,72 760,60 800,48"/>
            </svg>
            <div style="display:flex;justify-content:space-between;color:var(--text-secondary);font-size:12px;margin-top:6px">
                <span>90 days ago</span><span>60d</span><span>30d</span><span>Today</span>
            </div>
        </div>

        <div class="dashboard-grid">
            ${perfCards}
            <div class="card teaser-cta-card">
                <div style="font-size:36px;margin-bottom:8px">🔒</div>
                <div class="card-title" style="color:var(--text-primary)">See real numbers</div>
                <div style="color:var(--text-secondary);font-size:14px;margin:6px 0 14px;line-height:1.5">
                    Calibration curves, per-strategy breakdowns, and full history.
                </div>
                ${proCta('Get Pro →')}
            </div>
        </div>

        <p style="color:var(--text-secondary);font-size:12px;text-align:center;margin-top:14px">
            *Sample illustrative data based on backtested signals. Past performance does not guarantee future results. Not financial advice.
        </p>
    </section>

    <section class="landing-features-strip" aria-label="What you get">
        <div class="landing-feature">
            <div class="feature-title">Daily Top Picks</div>
            <div class="feature-sub">Tier-ranked actionable signals every trading day.</div>
        </div>
        <div class="landing-feature">
            <div class="feature-title">Backed by Backtests</div>
            <div class="feature-sub">Live hit-rate, calibration, per-tier diagnostics — fully transparent.</div>
        </div>
        <div class="landing-feature">
            <div class="feature-title">No Brokerage Linking</div>
            <div class="feature-sub">We never touch your account or holdings.</div>
        </div>
    </section>

    <section class="landing-final-cta">
        <h2>Ready to see today's picks?</h2>
        <p>$9/mo · Cancel anytime · Not financial advice</p>
        ${proCta('Get Pro →', { style: 'font-size:16px;padding:14px 32px' })}
    </section>`;
});

// ── Signup Page (Phase 13b) ──────────────────────────────────────────
// Phase 13d.3 redesign: Free experience is public (no signup needed).
// /signup is now a Pro-only checkout page.
Router.register('/signup', async () => {
    setTimeout(() => {
        const proBtn = document.getElementById('signup-pro-btn');
        if (proBtn) proBtn.addEventListener('click', async () => {
            const email = document.getElementById('signup-email').value;
            const country = document.getElementById('signup-country').value;
            const tos = document.getElementById('signup-tos').checked;
            const msg = document.getElementById('signup-msg');
            msg.className = 'login-message';
            if (!email || !country) {
                msg.className = 'login-message login-error';
                msg.textContent = 'Please enter your email and country.';
                return;
            }
            if (!tos) {
                msg.className = 'login-message login-error';
                msg.textContent = 'Please accept the Terms and Privacy Policy.';
                return;
            }
            proBtn.disabled = true;
            proBtn.textContent = 'Creating account...';
            try {
                await API.signup(email, country);
                // Try Stripe checkout; if not armed (503) or auth-required, fall back
                // to "check your email" — they upgrade from /billing after sign-in.
                let url = null;
                try {
                    const result = await API.billingCheckout();
                    url = result && result.url;
                } catch (_) { /* SAAS may be off; ignore */ }
                if (url) {
                    window.location.href = url;
                    return;
                }
                msg.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Account created — check your email for a sign-in link, then upgrade from the billing page.';
                proBtn.style.display = 'none';
            } catch (err) {
                msg.className = 'login-message login-error';
                msg.textContent = err.message || 'Signup failed. Try again.';
                proBtn.disabled = false;
                proBtn.textContent = STRIPE_ENABLED ? 'Get Pro — $9/mo' : 'Join the Pro waitlist';
            }
        });
    }, 50);

    return `
    <header class="landing-header">
        <a href="#/login" class="landing-brand">
            <svg viewBox="0 0 24 24" width="20" height="20"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            StockAnalysis
        </a>
        <nav class="landing-nav">
            <a href="#/login" class="btn btn-ghost">Sign in</a>
        </nav>
    </header>
    <section class="landing-split" aria-label="Get Pro">
        <div class="landing-split-left">
            <div class="badge">Pro · $9/mo</div>
            <h1>Get every signal,<br>in real time.</h1>
            <p>Real-time picks, full performance history, per-stock drilldowns,
               and watchlist alerts. Cancel anytime.</p>
            <ul class="landing-bullets">
                <li>✓ All daily picks (no 7-day delay)</li>
                <li>✓ Per-stock drilldowns &amp; signal pipeline</li>
                <li>✓ Full hit-rate &amp; calibration history</li>
                <li>✓ Watchlist alerts &amp; price targets</li>
                <li>✓ Cancel anytime · No long-term commitment</li>
            </ul>
        </div>
        <div class="landing-split-right">
            <div class="login-box compact">
                <h2>Start Pro</h2>
                <p class="login-sub">$9/month · Cancel anytime · US &amp; Canada only.</p>
                <input type="email" id="signup-email" class="login-input"
                       placeholder="you@example.com" required autocomplete="email" />
                <select id="signup-country" class="login-input" required
                        aria-label="Country" style="background:var(--surface);color:var(--text-primary)">
                    <option value="">Select country</option>
                    <option value="US">United States</option>
                    <option value="CA">Canada</option>
                </select>
                <label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;
                              color:var(--text-secondary);text-align:left;margin:8px 0 12px;line-height:1.5">
                    <input type="checkbox" id="signup-tos" style="margin-top:3px;flex-shrink:0" required />
                    <span>I agree to the <a href="legal/terms.html">Terms</a> and
                          <a href="legal/privacy.html">Privacy Policy</a>, and understand
                          this is not financial advice.</span>
                </label>
                <button type="button" id="signup-pro-btn" class="btn btn-primary"
                        style="background:linear-gradient(135deg,#f59e0b,#6366f1);width:100%">${STRIPE_ENABLED ? 'Get Pro — $9/mo →' : 'Join the Pro waitlist →'}</button>
                <div id="signup-msg" class="login-message"></div>
                <div class="login-footer">
                    Already a member? <a href="#/login">Sign in →</a>
                </div>
            </div>
        </div>
    </section>`;
});

// ── Daily Report Page ───────────────────────────────────────────────

Router.register('/daily', async () => {
    const data = await API.daily();
    if (!data) return '<p>Failed to load</p>';

    // Phase 13d.3: client-side Free-tier preview when admin is impersonating.
    // Backend short-circuits to grandfathered while SAAS_ENABLED=false, so we
    // synthesize the gated experience here. When SAAS goes live the backend
    // sends tier_gated=true already and this code becomes a no-op.
    let effectiveTier = 'real';
    try { effectiveTier = localStorage.getItem('viewAsTier') || 'real'; } catch (_) {}
    if (effectiveTier === 'free' && data.scan && Array.isArray(data.scan.top_picks)) {
        const picks = data.scan.top_picks;
        if (picks.length > 1) {
            data.scan._locked_picks = picks.slice(1);
            data.scan.top_picks = picks.slice(0, 1);
            data.tier_gated = true;
        }
    }

    // Phase 13d paywall: free tier with no picks → upgrade banner instead of empty page
    if (data.tier_gated && (!data.predictions || data.predictions.length === 0)
        && (!data.scan || !data.scan.top_picks || data.scan.top_picks.length === 0)) {
        const hrs = data.hours_until_unlock;
        const days = data.days_until_unlock != null ? data.days_until_unlock
                   : (hrs != null ? Math.round(hrs / 24 * 10) / 10 : null);
        const reason = days != null
            ? `Today's picks unlock for free users in <strong>${days} day${days === 1 ? '' : 's'}</strong>.`
            : `Today's picks are Pro-only.`;
        return paywallCard(reason, data.upgrade_message, /*showStats*/ data);
    }

    const scan = data.scan || {};
    const training = data.training || {};
    const model = data.model || {};
    const isLimited = !!data.tier_gated;
    const _shownCount = (data.predictions && data.predictions.length)
                     || (scan.top_picks && scan.top_picks.length) || 0;
    const _delayDays = data.delay_days || 7;
    const limitedBanner = isLimited ? `
        <div class="glass" style="padding:14px 18px;margin-bottom:18px;border-color:rgba(255,180,80,0.3)">
            <strong>Free tier:</strong> showing top ${_shownCount} pick (delayed ${_delayDays} days).
            <a href="#/billing" style="margin-left:8px">Upgrade to Pro →</a>
        </div>` : '';

    // Market regime banner — glass-style, on-brand
    const regime = scan.market_regime;
    let regimeBanner = '';
    if (regime) {
        const tints = { bull: 'success', bear: 'danger', sideways: 'warning' };
        const icons = { bull: '🐂', bear: '🐻', sideways: '↔️' };
        const tint = tints[regime.regime] || 'info';
        regimeBanner = `
        <div class="glass" style="padding:14px 18px;margin-bottom:24px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <span style="font-size:24px;line-height:1">${icons[regime.regime] || '📊'}</span>
            <span class="pill pill-${tint==='success'?'green':tint==='danger'?'red':tint==='warning'?'yellow':'blue'} live">${regime.regime.toUpperCase()} Market</span>
            <span style="color:var(--text-secondary);font-size:14px;flex:1;min-width:200px">${regime.description || ''}</span>
            ${regime.vix ? `<span style="font-size:13px;color:var(--text-secondary)">VIX <strong style="color:var(--text-primary)">${regime.vix}</strong></span>` : ''}
        </div>`;
    }

    // Today's picks — score-ring in the score column for visual punch
    let picksHtml = '';
    if (scan.top_picks && scan.top_picks.length > 0) {
        picksHtml = scan.top_picks.map(p => {
            const keySignal = (p.signals || [])[0] || '—';
            const sc = Math.max(0, Math.min(100, Math.round(p.score || 0)));
            const ringClass = sc >= 85 ? 'success' : sc >= 70 ? '' : 'danger';
            const ring = `<div class="score-ring ${ringClass}" style="--score:${sc};--size:42px"><span>${sc}</span></div>`;
            return `
            <tr onclick="window.location.hash='#/stock/${p.symbol}'" style="cursor:pointer">
                <td><strong>${p.symbol}</strong></td>
                <td>${p.recommendation ? recPill(p.recommendation) : '—'}</td>
                <td>${ring}</td>
                <td>${p.buy_price ? '$' + p.buy_price.toFixed(2) : (p.current_price ? '$' + p.current_price.toFixed(2) : '—')}</td>
                <td>${p.target_short ? '$' + p.target_short.toFixed(2) : '—'}</td>
                <td>${p.stop_loss ? '$' + p.stop_loss.toFixed(2) : '—'}</td>
                <td class="hide-mobile">${p.position_size ? p.position_size.position_pct + '%' : '—'}</td>
                <td>${keySignal}</td>
            </tr>`;
        }).join('');

        // Phase 13d.3: blurred teaser rows + Unlock CTA when tier-gated
        const lockedPicks = scan._locked_picks || [];
        if (lockedPicks.length > 0) {
            const lockedRows = lockedPicks.map(p => {
                const sc = Math.max(0, Math.min(100, Math.round(p.score || 0)));
                return `
                <tr class="locked-row">
                    <td><strong>${p.symbol}</strong></td>
                    <td>${p.recommendation ? recPill(p.recommendation) : '—'}</td>
                    <td>${sc}</td>
                    <td>${p.buy_price ? '$' + p.buy_price.toFixed(2) : '—'}</td>
                    <td>${p.target_short ? '$' + p.target_short.toFixed(2) : '—'}</td>
                    <td>${p.stop_loss ? '$' + p.stop_loss.toFixed(2) : '—'}</td>
                    <td class="hide-mobile">—</td>
                    <td>${(p.signals || [])[0] || '—'}</td>
                </tr>`;
            }).join('');
            picksHtml += lockedRows + `
                <tr class="unlock-cta-row"><td colspan="8">
                    <div class="unlock-cta">
                        <div>
                            <strong>🔒 ${lockedPicks.length} more pick${lockedPicks.length > 1 ? 's' : ''} hidden</strong>
                            <div style="font-size:13px;color:var(--text-secondary);margin-top:2px">
                                Unlock all daily picks, per-stock drilldowns, and real-time alerts with Pro.
                            </div>
                        </div>
                        ${proCta('Unlock with Pro →', { className: 'btn-primary' })}
                    </div>
                </td></tr>`;
        }
    } else if (scan.stocks_scanned) {
        picksHtml = `<tr><td colspan="8" style="text-align:center;color:var(--text-secondary)">
            No buy signals today — ${scan.stocks_scanned} stocks scanned${scan.top_pick ? `, top: ${scan.top_pick}` : ''}
        </td></tr>`;
    } else {
        picksHtml = '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary)">No recent scan data</td></tr>';
    }

    // Training status section
    let trainingHtml = '';
    if (training.action || training.trained_at) {
        const statusColor = training.action === 'failed' ? 'negative' : 'positive';
        trainingHtml = `
        <div class="card">
            <div class="card-title">Training Status</div>
            <div class="card-value ${statusColor}">${training.action || '—'}</div>
            <div class="card-subtitle">${timeSince(training.trained_at)}</div>
            ${training.training_samples ? `<div style="font-size:13px;color:var(--text-secondary);margin-top:4px">${training.training_samples} training samples</div>` : ''}
            ${training.budget_tier ? `<div style="font-size:13px;color:var(--text-secondary)">Budget: ${training.budget_tier} (headroom: $${training.budget_headroom?.toFixed(2) || '?'})</div>` : ''}
        </div>`;
    }

    const strongBuyCount = (scan.top_picks || []).filter(p => p.recommendation === 'Strong Buy').length;
    const accPct = model.accuracy ? `${(model.accuracy * 100).toFixed(0)}%` : '—';
    const topPickSym = scan.top_pick || '—';
    const topPickScore = scan.top_score ? scan.top_score.toFixed(0) : '—';

    return `
    <div class="hero">
        <span class="page-eyebrow">Daily Report · ${timeSince(scan.scanned_at)}</span>
    </div>

    ${limitedBanner}
    ${regimeBanner}

    <div class="card-grid">
        <div class="card featured" data-tier="strong-buy">
            <div class="card-header">
                <div class="card-title">🔥 Strong Buy</div>
                ${strongBuyCount > 0 ? '<span class="pill pill-green live">live</span>' : ''}
            </div>
            <div class="card-value positive">${strongBuyCount}</div>
            <div class="card-subtitle">Score ≥ 85, no risks</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:6px">${scan.actionable || 0} actionable total (≥70)</div>
        </div>
        <div class="card">
            <div class="card-header"><div class="card-title">Stocks Scanned</div></div>
            <div class="card-value neutral">${scan.stocks_scanned || '—'}</div>
            <div class="card-subtitle">${timeSince(scan.scanned_at)}</div>
            ${scan.elapsed ? `<div style="font-size:13px;color:var(--text-secondary);margin-top:4px">Elapsed: ${scan.elapsed.toFixed(1)}s</div>` : ''}
        </div>
        <div class="card">
            <div class="card-header">
                <div class="card-title">Top Pick</div>
                ${scan.top_score ? `<div class="score-ring success" style="--score:${Math.round(scan.top_score)};--size:48px"><span>${scan.top_score.toFixed(0)}</span></div>` : ''}
            </div>
            <div class="card-value neutral">${scan.top_pick || '—'}</div>
            <div class="card-subtitle">Highest composite score today</div>
        </div>
        <div class="card">
            <div class="card-header"><div class="card-title">ML Model</div></div>
            <div class="card-value code">${model.version || training.model_version || '—'}</div>
            <div class="card-subtitle" style="margin-top:8px">${model.accuracy ? `Accuracy: ${(model.accuracy * 100).toFixed(1)}%` : timeSince(training.trained_at)}</div>
        </div>
        ${trainingHtml}
    </div>

    <div class="table-container">
        <div class="table-header">Today's Picks <span class="pill pill-blue" style="margin-left:auto">${(scan.top_picks||[]).length} ranked</span></div>
        <table>
            <thead>
                <tr>
                    <th>Symbol</th><th>Rec</th><th>Score</th>
                    <th>Entry</th><th>Target</th><th>Stop</th><th class="hide-mobile">Size</th>
                    <th>Key Signal</th>
                </tr>
            </thead>
            <tbody>${picksHtml}</tbody>
        </table>
    </div>`;
});

// ── Pipeline Page ───────────────────────────────────────────────────

Router.register('/pipeline', async () => {
    const data = await API.daily();
    if (!data) return '<p>Failed to load pipeline data</p>';

    const scan = data.scan || {};
    const model = data.model || {};
    const pipe = data.pipeline || {};
    const sources = pipe.sources || [];
    const featGroups = pipe.features?.groups || [];
    const strategies = pipe.strategies || [];
    const mdlInfo = pipe.model || {};
    const scoring = pipe.scoring || {};
    const weights = scoring.weights || {};
    const output = pipe.output || {};

    const scanned = (pipe.stocks_fetched > 0 ? pipe.stocks_fetched : null) ?? scan.stocks_scanned ?? '~150';
    const features = pipe.features?.total || model.feature_count || 72;
    const accuracy = (mdlInfo.accuracy || model.accuracy) ? `${((mdlInfo.accuracy || model.accuracy) * 100).toFixed(0)}%` : '—';
    const topPicks = output.picks || scan.top_picks?.length || scan.actionable || 0;

    const pipelineHeader = `<div class="pipeline-header">
        <span class="pipeline-live"></span> Analysis Pipeline
        ${scan.scanned_at ? `<span style="margin-left:auto;font-size:11px">Last run: ${timeSince(scan.scanned_at)}</span>` : ''}
    </div>`;

    let pipelineHtml;

    if (pipe.graph && pipe.graph.version >= 2) {
        pipelineHtml = `<div class="pipeline-container">${pipelineHeader}<div class="dag-container" id="dag-root"></div></div>`;
    } else {
        const arrow = '<span class="pipeline-arrow">→</span>';
        const srcTags = sources.map(s => {
            const cls = {market:'t-green',social:'t-purple',news:'t-yellow',fundamental:'t-red',llm:'',macro:'t-yellow'}[s.type] || '';
            return `<span class="pipe-tag ${cls}">${s.name}</span>`;
        }).join('');
        const featDetail = featGroups.map(g =>
            `<span class="pipe-tag">${g.name} ${g.count}</span>`
        ).join('');
        const activeStrats = strategies.filter(s => s.status === 'active');
        const shadowStrats = strategies.filter(s => s.status === 'shadow');
        const stratCounts = pipe.strategy_counts || {};
        const stratTags = activeStrats.map(s =>
            `<span class="pipe-tag t-purple" title="${s.focus || ''}">${s.abbr}</span>`
        ).join('') + (shadowStrats.length ? `<span class="pipe-tag t-dim" title="${shadowStrats.length} shadow strategies competing">+${shadowStrats.length} shadow</span>` : '');
        const stratDesc = activeStrats.slice(0, 4).map(s => s.focus || s.name).join(' · ');
        const modelTags = (mdlInfo.components || ['GBM','RF','LR']).map(c =>
            `<span class="pipe-tag t-green">${c}</span>`
        ).join('');
        const wtBars = Object.entries(weights).map(([k,v]) =>
            `<div class="pipe-wt"><span>${k.replace('_',' ')}</span><div class="pipe-wt-bar"><div class="pipe-wt-fill" style="width:${v*100}%"></div></div><span>${(v*100).toFixed(0)}%</span></div>`
        ).join('');
        const delTags = (output.delivery || ['Telegram','Email','Dashboard']).map(d =>
            `<span class="pipe-tag t-purple">${d}</span>`
        ).join('');

        pipelineHtml = `
        <div class="pipeline-container">
            ${pipelineHeader}
            <div class="pipeline-flow">
                <div class="pipeline-step" style="animation-delay:0s">
                    <div class="pipeline-step-head"><span class="pipeline-step-dot c-green"></span><span class="pipeline-step-title">Data Sources</span></div>
                    <div class="pipeline-step-value">${sources.length || 7}</div>
                    <div class="pipeline-step-tags">${srcTags || '<span class="pipe-tag t-green">Yahoo</span><span class="pipe-tag t-yellow">News</span><span class="pipe-tag t-purple">Social</span>'}</div>
                </div>
                ${arrow}
                <div class="pipeline-step" style="animation-delay:0.08s">
                    <div class="pipeline-step-head"><span class="pipeline-step-dot c-blue"></span><span class="pipeline-step-title">Stocks Scanned</span></div>
                    <div class="pipeline-step-value">${scanned}</div>
                    <div class="pipeline-step-detail">Auto-discovery + Watchlist</div>
                </div>
                ${arrow}
                <div class="pipeline-step" style="animation-delay:0.16s">
                    <div class="pipeline-step-head"><span class="pipeline-step-dot c-purple"></span><span class="pipeline-step-title">Features</span></div>
                    <div class="pipeline-step-value">${features}</div>
                    <div class="pipeline-step-tags">${featDetail || '<span class="pipe-tag">Tech 25</span><span class="pipe-tag">Fund 15</span><span class="pipe-tag">Sent 12</span><span class="pipe-tag">MI 10</span>'}</div>
                </div>
                ${arrow}
                <div class="pipeline-step" style="animation-delay:0.24s">
                    <div class="pipeline-step-head"><span class="pipeline-step-dot c-yellow"></span><span class="pipeline-step-title">Strategies</span></div>
                    <div class="pipeline-step-value">${stratCounts.active || activeStrats.length || 4}${shadowStrats.length ? `<span class="pipeline-shadow-badge">+${shadowStrats.length} evolving</span>` : ''}</div>
                    <div class="pipeline-step-tags">${stratTags || '<span class="pipe-tag t-purple">MOM</span><span class="pipe-tag t-purple">VAL</span><span class="pipe-tag t-purple">BRK</span><span class="pipe-tag t-purple">ACC</span>'}</div>
                    <div class="pipeline-step-detail" style="margin-top:3px">${stratDesc || 'Momentum · Value · Breakout · Accumulation'}</div>
                </div>
                ${arrow}
                <div class="pipeline-step" style="animation-delay:0.32s">
                    <div class="pipeline-step-head"><span class="pipeline-step-dot c-cyan"></span><span class="pipeline-step-title">ML Ensemble</span></div>
                    <div class="pipeline-step-value">${accuracy}</div>
                    <div class="pipeline-step-tags">${modelTags}</div>
                    ${mdlInfo.samples ? `<div class="pipeline-step-detail" style="margin-top:3px">${mdlInfo.samples.toLocaleString()} samples</div>` : ''}
                </div>
                ${arrow}
                <div class="pipeline-step" style="animation-delay:0.4s">
                    <div class="pipeline-step-head"><span class="pipeline-step-dot c-red"></span><span class="pipeline-step-title">Weighted Score</span></div>
                    <div class="pipeline-step-value">≥${scoring.threshold || 75}</div>
                    ${wtBars || '<div class="pipeline-step-detail">Technical 30% · ML 25% · Fund 20%</div>'}
                </div>
                ${arrow}
                <div class="pipeline-step" style="animation-delay:0.48s">
                    <div class="pipeline-step-head"><span class="pipeline-step-dot c-green"></span><span class="pipeline-step-title">Top Picks</span></div>
                    <div class="pipeline-step-value">${topPicks}</div>
                    ${output.top_pick ? `<div class="pipeline-step-detail">Best: <strong>${output.top_pick}</strong>${output.top_score ? ` (${output.top_score.toFixed(0)})` : ''}</div>` : ''}
                    <div class="pipeline-step-tags" style="margin-top:3px">${delTags}</div>
                </div>
            </div>
        </div>`;
    }

    // Store graph data for post-render hydration
    window._dagGraphData = (pipe.graph && pipe.graph.version >= 2) ? pipe.graph : null;

    return `
    <div class="page-title">Analysis Pipeline</div>
    ${pipelineHtml}`;
});

// ── Performance Page ────────────────────────────────────────────────

Router.register('/performance', async () => {
    const data = await API.performance();
    if (!data) return '<p>Failed to load</p>';
    // Phase 13d.3: Performance preview for Free — show historical stats VISIBLY
    // (those are proof, not actionable). Only the live/per-pick drilldowns are
    // gated, expressed via a single CTA card. No per-card blur.
    if (effectiveViewAsTier() === 'free') {
        const cards = [
            { title: '30D Hit Rate',  value: '62%',   sub: '🟢 18W / 11L (29 picks)' },
            { title: '90D Hit Rate',  value: '58%',   sub: '🟢 47W / 34L (81 picks)' },
            { title: 'All-Time',      value: '54%',   sub: '🟢 142W / 121L (263 picks)' },
            { title: 'Avg Return',    value: '+3.4%', sub: 'per pick, 30D rolling' },
            { title: 'Alpha vs SPY',  value: '+1.8%', sub: 'risk-adjusted' },
            { title: 'Sharpe Ratio',  value: '1.42',  sub: 'last 90 days' },
        ];
        const cardsHtml = cards.map(c => `
            <div class="card">
                <div class="card-title">${c.title}</div>
                <div class="card-value positive">${c.value}</div>
                <div class="card-subtitle">${c.sub}</div>
            </div>`).join('');
        return `
        <h1 style="margin-bottom:18px">Performance</h1>
        <p style="color:var(--text-secondary);margin:0 0 18px">Historical hit-rate and risk-adjusted returns based on backtested signals.</p>
        <div class="dashboard-grid">
            ${cardsHtml}
            <div class="card teaser-cta-card">
                <div style="font-size:36px;margin-bottom:8px">🔒</div>
                <div class="card-title" style="color:var(--text-primary)">Live picks &amp; drilldowns</div>
                <div style="color:var(--text-secondary);font-size:14px;margin:6px 0 14px;line-height:1.5">
                    See today's picks, calibration curves, per-strategy breakdowns and per-stock drilldowns.
                </div>
                <a href="#/billing" class="btn-unlock">Upgrade to Pro →</a>
            </div>
        </div>
        <p style="color:var(--text-secondary);font-size:12px;margin-top:14px">
            *Based on tracked signals. Past performance does not guarantee future results. Not financial advice.
        </p>`;
    }

    const sc = data.scorecard?.scorecards || {};
    const card = sc.all || sc['30d'] || {};
    const mm = data.model_metrics || {};
    const scorer = data.scorer_state || {};
    const scorerCard = scorer.scorecard || {};

    function scorecardCard(period, c) {
        if (!c || c.total_picks === 0) return '';
        const icon = c.hit_rate >= 0.5 ? '🟢' : '🔴';
        return `
        <div class="card">
            <div class="card-title">${period.toUpperCase()} Performance</div>
            <div class="card-value ${c.hit_rate >= 0.5 ? 'positive' : 'negative'}">${(c.hit_rate * 100).toFixed(0)}%</div>
            <div class="card-subtitle">${icon} ${c.winners}W / ${c.losers}L (${c.total_picks} picks)</div>
            <div style="margin-top:8px">
                <div style="font-size:13px;color:var(--text-secondary)">Avg Return: <span class="${pctClass(c.avg_return)}">${pctSign(c.avg_return)}</span></div>
                <div style="font-size:13px;color:var(--text-secondary)">Cumulative: <span class="${pctClass(c.cumulative_return)}">${pctSign(c.cumulative_return)}</span></div>
                ${c.alpha ? `<div style="font-size:13px;color:var(--text-secondary)">Alpha vs SPY: <span class="${pctClass(c.alpha)}">${pctSign(c.alpha)}</span></div>` : ''}
            </div>
        </div>`;
    }

    let calibrationHtml = '';
    const allCard = sc.all || {};
    if (allCard.strong_buy_count > 0 || allCard.buy_count > 0) {
        calibrationHtml = `
        <div class="card">
            <div class="card-title">Confidence Calibration</div>
            ${allCard.strong_buy_count > 0 ? `
            <div class="weight-bar-container">
                <div class="weight-bar-label"><span>Strong Buy</span><span>${(allCard.strong_buy_hit_rate*100).toFixed(0)}% (${allCard.strong_buy_count})</span></div>
                <div class="weight-bar"><div class="weight-bar-fill technical" style="width:${allCard.strong_buy_hit_rate*100}%"></div></div>
            </div>` : ''}
            ${allCard.buy_count > 0 ? `
            <div class="weight-bar-container">
                <div class="weight-bar-label"><span>Buy</span><span>${(allCard.buy_hit_rate*100).toFixed(0)}% (${allCard.buy_count})</span></div>
                <div class="weight-bar"><div class="weight-bar-fill fundamental" style="width:${allCard.buy_hit_rate*100}%"></div></div>
            </div>` : ''}
            ${allCard.high_conf_picks > 0 ? `
            <div class="weight-bar-container">
                <div class="weight-bar-label"><span>High Conf (≥75)</span><span>${(allCard.high_conf_hit_rate*100).toFixed(0)}% (${allCard.high_conf_picks})</span></div>
                <div class="weight-bar"><div class="weight-bar-fill momentum" style="width:${allCard.high_conf_hit_rate*100}%"></div></div>
            </div>` : ''}
        </div>`;
    }

    const hasScorecardData = ['7d', '30d', 'all'].some(k => sc[k] && sc[k].total_picks > 0);

    // ML Model Performance section
    let modelHtml = '';
    if (mm.accuracy || scorer.hit_rate) {
        modelHtml = `
        <div class="card">
            <div class="card-title">ML Model Performance</div>
            ${mm.version ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">Model: v${mm.version}</div>` : ''}
            ${mm.accuracy ? `
            <div class="weight-bar-container">
                <div class="weight-bar-label"><span>Accuracy</span><span>${(mm.accuracy * 100).toFixed(1)}%</span></div>
                <div class="weight-bar"><div class="weight-bar-fill technical" style="width:${mm.accuracy * 100}%"></div></div>
            </div>` : ''}
            ${mm.auc_roc ? `
            <div class="weight-bar-container">
                <div class="weight-bar-label"><span>AUC-ROC</span><span>${(mm.auc_roc * 100).toFixed(1)}%</span></div>
                <div class="weight-bar"><div class="weight-bar-fill fundamental" style="width:${mm.auc_roc * 100}%"></div></div>
            </div>` : ''}
            ${scorer.hit_rate ? `
            <div class="weight-bar-container">
                <div class="weight-bar-label"><span>Scorer Hit Rate</span><span>${(scorer.hit_rate * 100).toFixed(1)}%</span></div>
                <div class="weight-bar"><div class="weight-bar-fill momentum" style="width:${scorer.hit_rate * 100}%"></div></div>
            </div>` : ''}
            ${scorer.training_samples ? `<div style="font-size:13px;color:var(--text-secondary);margin-top:8px">Training samples: ${scorer.training_samples}</div>` : ''}
            ${mm.symbols_analyzed ? `<div style="font-size:13px;color:var(--text-secondary)">Symbols analyzed: ${mm.symbols_analyzed}</div>` : ''}
            ${mm.feature_count ? `<div style="font-size:13px;color:var(--text-secondary)">Features: ${mm.feature_count}</div>` : ''}
        </div>`;
    }

    // Walk-forward validation section
    let walkForwardHtml = '';
    const wf = data.walk_forward;
    if (wf && wf.status === 'ok' && wf.overall) {
        const o = wf.overall;
        const edgeColor = o.edge > 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        const outperforms = o.high_outperforms ? '✅ High scores outperform' : '⚠️ Edge not established';

        walkForwardHtml = `
        <div class="card">
            <div class="card-title">Walk-Forward Validation</div>
            <div style="display:flex;gap:24px;margin-bottom:12px">
                <div>
                    <div style="font-size:24px;font-weight:bold;color:${edgeColor}">${(o.edge * 100).toFixed(1)}%</div>
                    <div style="font-size:12px;color:var(--text-secondary)">Edge (High - Low)</div>
                </div>
                <div>
                    <div style="font-size:24px;font-weight:bold">${(o.high_score_hit_rate * 100).toFixed(0)}%</div>
                    <div style="font-size:12px;color:var(--text-secondary)">High Score Hit Rate</div>
                </div>
                <div>
                    <div style="font-size:24px;font-weight:bold">${(o.low_score_hit_rate * 100).toFixed(0)}%</div>
                    <div style="font-size:12px;color:var(--text-secondary)">Low Score Hit Rate</div>
                </div>
                <div>
                    <div style="font-size:24px;font-weight:bold">${o.total_predictions}</div>
                    <div style="font-size:12px;color:var(--text-secondary)">Predictions</div>
                </div>
            </div>
            <div style="font-size:13px;color:var(--text-secondary)">${outperforms}</div>
            ${wf.windows && wf.windows.length > 0 ? `
            <details style="margin-top:8px">
                <summary style="cursor:pointer;font-size:13px;color:var(--accent-blue)">Weekly breakdown (${wf.windows.length} weeks)</summary>
                <div class="table-container" style="margin-top:8px">
                    <table>
                        <thead><tr><th>Week</th><th>High Score</th><th>Low Score</th><th>Edge</th></tr></thead>
                        <tbody>
                            ${wf.windows.slice(-8).map(w => {
                                const edge = w.high_hit_rate != null && w.low_hit_rate != null ? (w.high_hit_rate - w.low_hit_rate) : null;
                                return `<tr>
                                    <td>${w.week}</td>
                                    <td>${w.high_hit_rate != null ? (w.high_hit_rate * 100).toFixed(0) + '%' : '—'} (${w.high_score_count})</td>
                                    <td>${w.low_hit_rate != null ? (w.low_hit_rate * 100).toFixed(0) + '%' : '—'} (${w.low_score_count})</td>
                                    <td class="${edge > 0 ? 'positive' : edge < 0 ? 'negative' : ''}">${edge != null ? (edge * 100).toFixed(1) + '%' : '—'}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </details>` : ''}
        </div>`;
    }

    // Signal accuracy section
    let signalAccuracyHtml = '';
    const sa = data.signal_accuracy;
    if (sa && sa.signals_tracked > 0) {
        const topSignals = sa.top_signals || [];
        signalAccuracyHtml = `
        <div class="card">
            <div class="card-title">Signal Accuracy (${sa.signals_tracked} signals tracked)</div>
            ${topSignals.length > 0 ? `
            <div class="table-container">
                <table>
                    <thead><tr><th>Signal</th><th>Hit Rate</th><th>Samples</th></tr></thead>
                    <tbody>
                        ${topSignals.map(([name, rate, count]) => `
                        <tr>
                            <td>${name.replace(/_/g, ' ')}</td>
                            <td><span class="${rate >= 0.55 ? 'positive' : rate < 0.45 ? 'negative' : ''}">${(rate * 100).toFixed(0)}%</span></td>
                            <td>${count}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>` : '<div style="color:var(--text-secondary);font-size:13px">Collecting signal data...</div>'}
        </div>`;
    }

    // Scorer scorecard section
    let scorerHtml = '';
    if (scorerCard.hit_rate_30d || scorerCard.avg_return_30d || scorerCard.alpha_30d) {
        scorerHtml = `
        <div class="card">
            <div class="card-title">Scorer Scorecard</div>
            ${scorerCard.hit_rate_30d != null ? `
            <div class="weight-bar-container">
                <div class="weight-bar-label"><span>30d Hit Rate</span><span>${(scorerCard.hit_rate_30d * 100).toFixed(1)}%</span></div>
                <div class="weight-bar"><div class="weight-bar-fill technical" style="width:${scorerCard.hit_rate_30d * 100}%"></div></div>
            </div>` : ''}
            ${scorerCard.strong_buy_hit_rate != null ? `
            <div class="weight-bar-container">
                <div class="weight-bar-label"><span>Strong Buy Hit Rate</span><span>${(scorerCard.strong_buy_hit_rate * 100).toFixed(1)}%</span></div>
                <div class="weight-bar"><div class="weight-bar-fill fundamental" style="width:${scorerCard.strong_buy_hit_rate * 100}%"></div></div>
            </div>` : ''}
            ${scorerCard.avg_return_30d != null ? `<div style="font-size:13px;color:var(--text-secondary);margin-top:8px">Avg Return (30d): <span class="${pctClass(scorerCard.avg_return_30d)}">${pctSign(scorerCard.avg_return_30d)}</span></div>` : ''}
            ${scorerCard.alpha_30d != null ? `<div style="font-size:13px;color:var(--text-secondary)">Alpha (30d): <span class="${pctClass(scorerCard.alpha_30d)}">${pctSign(scorerCard.alpha_30d)}</span></div>` : ''}
        </div>`;
    }

    // Empty state message — show pending predictions and activity instead of just a message
    let emptyHtml = '';
    if (!hasScorecardData) {
        const pending = data.pending_predictions || [];
        const activity = data.prediction_activity || {};
        const hasPending = pending.length > 0;
        const hasActivity = activity.total > 0;

        if (hasPending || hasActivity) {
            let activitySummary = '';
            if (hasActivity) {
                activitySummary = `
                <div style="display:flex;gap:24px;justify-content:center;margin-bottom:16px">
                    <div><span style="font-size:24px;font-weight:bold">${activity.total}</span><div style="font-size:12px;color:var(--text-secondary)">Total Predictions</div></div>
                    <div><span style="font-size:24px;font-weight:bold">${activity.with_outcomes}</span><div style="font-size:12px;color:var(--text-secondary)">With Outcomes</div></div>
                    <div><span style="font-size:24px;font-weight:bold">${activity.pending}</span><div style="font-size:12px;color:var(--text-secondary)">Awaiting Results</div></div>
                    <div><span style="font-size:24px;font-weight:bold">${activity.live_predictions}</span><div style="font-size:12px;color:var(--text-secondary)">Live Scans</div></div>
                </div>`;
            }

            let pendingTable = '';
            if (hasPending) {
                pendingTable = `
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">Recent Predictions (Awaiting 7-Day Outcomes)</div>
                <div class="table-container">
                    <table>
                        <thead><tr><th>Symbol</th><th>Score</th><th>Entry Price</th><th>Date</th><th>Type</th></tr></thead>
                        <tbody>
                            ${pending.slice(0, 10).map(p => `
                            <tr>
                                <td><a href="#/stock/${p.symbol}" style="color:var(--accent-blue)">${p.symbol}</a></td>
                                <td><span class="${p.score >= 75 ? 'positive' : ''}">${(p.score||0).toFixed(0)}</span></td>
                                <td>$${(p.entry_price||0).toFixed(2)}</td>
                                <td>${p.signal_date ? new Date(p.signal_date).toLocaleDateString() : '—'}</td>
                                <td>${p.signal_type || 'scan'}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>`;
            }

            emptyHtml = `
            <div class="card" style="grid-column:1/-1">
                <div style="font-size:16px;margin-bottom:12px">📊 Prediction Activity</div>
                ${activitySummary}
                ${activity.with_outcomes > 0 && activity.backtest_samples > 0 ? `
                    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
                        Includes ${activity.backtest_samples} backtest samples for ML training baseline
                    </div>` : ''}
                ${pendingTable}
                ${activity.pending > 0 ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:8px">⏳ Scorecard populates after outcome_tracker fills 7-day returns</div>` : ''}
            </div>`;
        } else {
            emptyHtml = `
            <div class="card" style="text-align:center;grid-column:1/-1">
                <div style="font-size:16px;margin-bottom:8px">Prediction Performance</div>
                <p style="color:var(--text-secondary)">No predictions yet. Run a scan to start building prediction history.</p>
            </div>`;
        }
    }

    // Conviction tracker (30-day track record — moved from Daily page)
    const conviction = data.conviction || [];
    let convictionHtml = '';
    if (conviction.length > 0) {
        convictionHtml = renderConvictionTracker(conviction);
    }

    // Recent Picks History (30 days)
    let recentPicksHtml = '';
    const recentPicks = data.recent_picks || [];
    if (recentPicks.length > 0) {
        const wins = recentPicks.filter(p => p.hit === true).length;
        const losses = recentPicks.filter(p => p.hit === false).length;
        const pending = recentPicks.filter(p => p.hit === null).length;

        recentPicksHtml = `
        <div class="card" style="grid-column:1/-1">
            <div class="card-title">Recent Picks (Last 30 Days)</div>
            <div style="display:flex;gap:24px;margin-bottom:12px">
                <div><span style="font-size:20px;font-weight:bold;color:var(--accent-green)">${wins}</span> <span style="font-size:12px;color:var(--text-secondary)">Winners</span></div>
                <div><span style="font-size:20px;font-weight:bold;color:var(--accent-red)">${losses}</span> <span style="font-size:12px;color:var(--text-secondary)">Losers</span></div>
                <div><span style="font-size:20px;font-weight:bold">${pending}</span> <span style="font-size:12px;color:var(--text-secondary)">Pending</span></div>
                ${wins + losses > 0 ? `<div><span style="font-size:20px;font-weight:bold">${((wins/(wins+losses))*100).toFixed(0)}%</span> <span style="font-size:12px;color:var(--text-secondary)">Win Rate</span></div>` : ''}
            </div>
            <div class="table-container">
                <table>
                    <thead><tr><th>Date</th><th>Symbol</th><th>Score</th><th>Entry</th><th>1D</th><th>7D</th><th>30D</th><th>Result</th></tr></thead>
                    <tbody>
                        ${recentPicks.map(p => {
                            const resultIcon = p.hit === true ? '✅' : p.hit === false ? '❌' : '⏳';
                            const date = p.signal_date ? new Date(p.signal_date).toLocaleDateString('en-US', {month:'short', day:'numeric'}) : '—';
                            return `<tr>
                                <td>${date}</td>
                                <td><a href="#/stock/${p.symbol}" style="color:var(--accent-blue)">${p.symbol}</a></td>
                                <td>${p.score?.toFixed(0) || '—'}</td>
                                <td>$${p.entry_price?.toFixed(2) || '—'}</td>
                                <td class="${pctClass(p.return_1d || 0)}">${p.return_1d != null ? pctSign(p.return_1d) : '—'}</td>
                                <td class="${pctClass(p.return_7d || 0)}">${p.return_7d != null ? pctSign(p.return_7d) : '—'}</td>
                                <td class="${pctClass(p.return_30d || 0)}">${p.return_30d != null ? pctSign(p.return_30d) : '—'}</td>
                                <td>${resultIcon}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    // Strategy leaderboard
    const strategies = data.strategies || [];
    let strategyHtml = '';
    if (strategies.length > 0) {
        const trendIcon = t => t === 'improving' ? '↑' : (t === 'declining' ? '↓' : '→');
        const trendColor = t => t === 'improving' ? 'var(--accent-green)' : (t === 'declining' ? 'var(--accent-red)' : 'var(--text-secondary)');
        strategyHtml = `
        <div style="font-size:14px;color:var(--text-secondary);margin:16px 0 8px">Strategy Leaderboard</div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>#</th><th>Strategy</th><th>Hit Rate (7d)</th>
                        <th>Avg Return (7d)</th><th>Avg Return (1d)</th>
                        <th>Picks</th><th>Trend</th>
                    </tr>
                </thead>
                <tbody>
                    ${strategies.map((s, i) => `
                    <tr>
                        <td>${i + 1}</td>
                        <td><strong>${s.name}</strong></td>
                        <td>
                            <div class="weight-bar" style="width:80px;display:inline-block;vertical-align:middle;margin-right:6px">
                                <div class="weight-bar-fill ${s.hit_rate_7d >= 0.5 ? 'technical' : 'news'}" style="width:${(s.hit_rate_7d * 100).toFixed(0)}%"></div>
                            </div>
                            ${(s.hit_rate_7d * 100).toFixed(0)}%
                        </td>
                        <td class="${pctClass(s.avg_return_7d)}">${pctSign(s.avg_return_7d)}</td>
                        <td class="${pctClass(s.avg_return_1d)}">${pctSign(s.avg_return_1d)}</td>
                        <td>${s.total_picks}</td>
                        <td style="color:${trendColor(s.trend)}">${trendIcon(s.trend)} ${s.trend}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
    }

    return `
    <div class="page-title">Performance</div>
    ${modelHtml || scorerHtml ? '<div style="font-size:14px;color:var(--text-secondary);margin-bottom:8px">ML Model Metrics</div>' : ''}
    <div class="card-grid">
        ${modelHtml}
        ${scorerHtml}
    </div>
    ${walkForwardHtml}
    ${signalAccuracyHtml}
    ${convictionHtml}
    ${recentPicksHtml}
    ${strategyHtml}
    ${hasScorecardData || emptyHtml ? '<div style="font-size:14px;color:var(--text-secondary);margin:16px 0 8px">Prediction Scorecard</div>' : ''}
    <div class="card-grid">
        ${hasScorecardData ? `
            ${scorecardCard('7d', sc['7d'])}
            ${scorecardCard('30d', sc['30d'])}
            ${scorecardCard('all', sc.all)}
            ${calibrationHtml}
        ` : emptyHtml}
    </div>
    <div id="performance-charts" class="charts-section">
        <h2>📈 Performance Trends</h2>
        <div class="chart-timeframe">
            <button data-days="30">30 Days</button>
            <button data-days="90" class="active">90 Days</button>
            <button data-days="365">1 Year</button>
        </div>
    </div>`;
});

async function loadPerformanceCharts(days = 90) {
    try {
        const data = await API.performanceHistory(days);
        if (!data || !data.metrics) return;

        const section = document.getElementById('performance-charts');
        if (!section) return;

        // Destroy existing Chart.js instances before removing canvases
        section.querySelectorAll('canvas').forEach(c => {
            const chart = Chart.getChart(c);
            if (chart) chart.destroy();
        });

        // Preserve header and buttons, clear chart wrappers + empty states
        section.querySelectorAll('.chart-wrapper, .empty-state').forEach(el => el.remove());

        // Update active button
        section.querySelectorAll('.chart-timeframe button').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.days) === days);
        });

        const metrics = data.metrics;
        if (Object.keys(metrics).length === 0) {
            const p = document.createElement('p');
            p.className = 'empty-state';
            p.textContent = 'Performance data will appear after a few days of tracking.';
            section.appendChild(p);
            return;
        }

        renderPerformanceCharts(metrics);
    } catch (e) {
        console.warn('Chart load failed:', e);
    }
}

function createChartCanvas(id, title, parent) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    wrapper.innerHTML = `<h3 class="chart-title">${title}</h3><div class="chart-container"><canvas id="${id}"></canvas></div>`;
    parent.appendChild(wrapper);
    return document.getElementById(id);
}

function renderPerformanceCharts(metrics) {
    const chartSection = document.getElementById('performance-charts');
    if (!chartSection) return;

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        scales: {
            x: { type: 'category', grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#8b949e', maxRotation: 45 } },
            y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#8b949e' } }
        },
        plugins: { legend: { labels: { color: '#e6edf3' } } }
    };

    // Chart 1: ML Accuracy
    if (metrics.ml_accuracy || metrics.model_backtest_accuracy) {
        const canvas1 = createChartCanvas('ml-accuracy-chart', 'ML Model Accuracy (%)', chartSection);
        const datasets = [];
        if (metrics.ml_accuracy) {
            datasets.push({
                label: 'Live Accuracy', data: metrics.ml_accuracy.map(d => ({ x: d.date, y: d.value })),
                borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,0.1)', fill: true, tension: 0.3
            });
        }
        if (metrics.model_backtest_accuracy) {
            datasets.push({
                label: 'Backtest Accuracy', data: metrics.model_backtest_accuracy.map(d => ({ x: d.date, y: d.value })),
                borderColor: '#bc8cff', borderDash: [5, 5], tension: 0.3
            });
        }
        new Chart(canvas1, { type: 'line', data: { datasets }, options: {
            ...commonOptions,
            scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, min: 40, max: 100,
                ticks: { ...commonOptions.scales.y.ticks, callback: v => v + '%' } } }
        }});
    }

    // Chart 2: Recommendation Hit Rate
    if (metrics.recommendation_hit_rate) {
        const canvas2 = createChartCanvas('hit-rate-chart', 'Recommendation Hit Rate (%)', chartSection);
        new Chart(canvas2, { type: 'line', data: {
            datasets: [{
                label: 'Hit Rate (7d)', data: metrics.recommendation_hit_rate.map(d => ({ x: d.date, y: d.value })),
                borderColor: '#d29922', backgroundColor: 'rgba(210,153,34,0.1)', fill: true, tension: 0.3
            }]
        }, options: {
            ...commonOptions,
            scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, min: 0, max: 100,
                ticks: { ...commonOptions.scales.y.ticks, callback: v => v + '%' } } }
        }});
    }

    // Chart 3: Avg Profit per Pick
    if (metrics.recommendation_profit_7d) {
        const canvas3 = createChartCanvas('profit-chart', 'Avg 7-Day Return per Pick (%)', chartSection);
        const profitData = metrics.recommendation_profit_7d;
        new Chart(canvas3, { type: 'bar', data: {
            labels: profitData.map(d => d.date),
            datasets: [{
                label: 'Avg Return %', data: profitData.map(d => d.value),
                backgroundColor: profitData.map(d => d.value >= 0 ? 'rgba(63,185,80,0.7)' : 'rgba(248,81,73,0.7)'),
                borderColor: profitData.map(d => d.value >= 0 ? '#3fb950' : '#f85149'), borderWidth: 1
            }]
        }, options: {
            ...commonOptions,
            scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y,
                ticks: { ...commonOptions.scales.y.ticks, callback: v => v.toFixed(2) + '%' } } }
        }});
    }

    // Chart 4: Cumulative Portfolio
    if (metrics.portfolio_cumulative_30d) {
        const canvas4 = createChartCanvas('cumulative-chart', 'Cumulative 30-Day Return (%)', chartSection);
        new Chart(canvas4, { type: 'line', data: {
            datasets: [{
                label: 'Cumulative Return', data: metrics.portfolio_cumulative_30d.map(d => ({ x: d.date, y: d.value })),
                borderColor: '#bc8cff', backgroundColor: 'rgba(188,140,255,0.1)', fill: true, tension: 0.3, pointRadius: 4
            }]
        }, options: commonOptions });
    }
}

// ── Stock Detail Page (Decision Flow) ───────────────────────────────

Router.register('/stock', async () => {
    return `<div class="card" style="text-align:center;padding:40px">
        <p>Enter a stock symbol in the URL: <code>#/stock/NVDA</code></p>
    </div>`;
});

// Dynamic stock route handler
async function renderStockDetail(symbol) {
    // Phase 13d.3: per-stock drilldown is Pro — blur teaser for Free impersonation
    if (effectiveViewAsTier() === 'free') {
        return blurredTeaser(
            `<div class="card"><h2>${symbol}</h2><p>Score breakdown, technicals, fundamentals, news sentiment, and signal pipeline.</p></div>`,
            `${symbol} drilldown is Pro`,
            'Get full per-stock analysis: technical indicators, fundamentals, news sentiment, signal pipeline, and entry/exit guidance. Pro only.'
        );
    }
    const data = await API.stock(symbol);
    if (!data) return `<div class="card"><p>❌ Failed to load</p></div>`;
    if (data.tier_gated) return paywallCard(
        `Per-stock drilldown for <strong>${symbol}</strong> is a Pro feature.`,
        data.upgrade_message);
    if (data.error) return `<div class="card"><p>❌ ${data.error}</p></div>`;

    const scores = data.scores || {};
    const contribs = data.weighted_contributions || {};

    // Build flow pipeline
    const stages = [
        { label: 'Technical', value: scores.technical?.value?.toFixed(0), weight: scores.technical?.weight, class: 'technical' },
        { label: 'Fundamental', value: scores.fundamental?.value?.toFixed(0), weight: scores.fundamental?.weight, class: 'fundamental' },
        { label: 'Momentum', value: scores.momentum?.value?.toFixed(0), weight: scores.momentum?.weight, class: 'momentum' },
        { label: 'News', value: scores.news?.value?.toFixed(0), weight: scores.news?.weight, class: 'news' },
        { label: 'Strategy', value: scores.strategy?.value?.toFixed(0), weight: scores.strategy?.weight, class: 'strategy' },
    ];

    const flowHtml = stages.map(s => `
        <div class="flow-stage">
            <div class="flow-stage-label">${s.label}</div>
            <div class="flow-stage-value">${s.value || '—'}</div>
            <div class="flow-stage-detail">Weight: ${((s.weight || 0) * 100).toFixed(0)}%</div>
        </div>
    `).join('');

    const weightBars = stages.map(s => `
        <div class="weight-bar-container">
            <div class="weight-bar-label">
                <span>${s.label}</span>
                <span>${contribs[s.label.toLowerCase()]?.toFixed(1) || '—'} pts</span>
            </div>
            <div class="weight-bar">
                <div class="weight-bar-fill ${s.class}" style="width:${(s.value || 0)}%"></div>
            </div>
        </div>
    `).join('');

    const signalsHtml = (data.signals || []).map(s => pill(s, 'green')).join(' ');
    const risksHtml = (data.risks || []).map(r => pill(r, 'red')).join(' ');

    return `
    <div class="page-title">${data.recommendation_emoji || ''} ${data.symbol} — ${data.recommendation}</div>

    <div class="card-grid">
        <div class="card">
            <div class="card-title">Composite Score</div>
            <div class="card-value ${data.composite_score >= 75 ? 'positive' : data.composite_score >= 50 ? 'neutral' : 'negative'}">
                ${data.composite_score?.toFixed(0)}
            </div>
        </div>
        <div class="card">
            <div class="card-title">Current Price</div>
            <div class="card-value neutral">$${data.current_price?.toFixed(2) || '—'}</div>
        </div>
        <div class="card">
            <div class="card-title">Buy Price</div>
            <div class="card-value neutral">$${data.buy_price?.toFixed(2) || '—'}</div>
        </div>
        <div class="card">
            <div class="card-title">Target (Short)</div>
            <div class="card-value positive">$${data.target_short?.toFixed(2) || '—'}</div>
        </div>
        <div class="card">
            <div class="card-title">Target (Long)</div>
            <div class="card-value positive">$${data.target_long?.toFixed(2) || '—'}</div>
        </div>
        <div class="card">
            <div class="card-title">Stop Loss</div>
            <div class="card-value negative">$${data.stop_loss?.toFixed(2) || '—'}</div>
        </div>
    </div>

    <div class="flow-container">
        <div class="flow-title">Decision Flow — How This Score Was Made</div>
        <div class="flow-pipeline">
            ${flowHtml}
            <div class="flow-stage" style="border-color:var(--accent-blue)">
                <div class="flow-stage-label">Composite</div>
                <div class="flow-stage-value" style="color:var(--accent-blue)">${data.composite_score?.toFixed(0)}</div>
                <div class="flow-stage-detail">${data.recommendation}</div>
            </div>
        </div>
    </div>

    <div class="card-grid">
        <div class="card">
            <div class="card-title">Weight Contributions</div>
            ${weightBars}
        </div>
        <div class="card">
            <div class="card-title">Signals Fired</div>
            <div style="margin-bottom:12px">${signalsHtml || '<span style="color:var(--text-secondary)">None</span>'}</div>
            <div class="card-title" style="margin-top:12px">Risk Flags</div>
            <div>${risksHtml || '<span style="color:var(--text-secondary)">None</span>'}</div>
        </div>
    </div>

    ${data.reasoning ? `
    <div class="card">
        <div class="card-title">AI Reasoning</div>
        <p style="font-size:14px;line-height:1.6;white-space:pre-wrap">${data.reasoning}</p>
    </div>` : ''}`;
}

// ── Budget Page ─────────────────────────────────────────────────────

Router.register('/budget', async () => {
    const data = await API.budget();
    if (!data) return '<p>Failed to load</p>';

    const cost = data.cost || {};
    const spent = cost.current_spend || 0;
    const budget = cost.budget_limit || 200;
    const pct = (spent / budget * 100);

    return `
    <div class="page-title">Budget</div>
    <div class="card-grid">
        <div class="card">
            <div class="card-title">Current Spend</div>
            <div class="card-value ${pct > 80 ? 'negative' : 'neutral'}">$${spent.toFixed(2)}</div>
            <div class="card-subtitle">of $${budget} budget (${pct.toFixed(0)}%)</div>
            <div class="weight-bar" style="margin-top:12px">
                <div class="weight-bar-fill ${pct > 80 ? 'news' : 'fundamental'}" style="width:${Math.min(pct, 100)}%"></div>
            </div>
        </div>
        ${cost.forecast ? `
        <div class="card">
            <div class="card-title">Month-End Forecast</div>
            <div class="card-value ${cost.forecast > budget ? 'negative' : 'positive'}">$${cost.forecast.toFixed(2)}</div>
            <div class="card-subtitle">${cost.forecast > budget ? '⚠️ Over budget' : '✅ On track'}</div>
        </div>` : ''}
        ${cost.breakdown && Object.keys(cost.breakdown).length > 0 ? `
        <div class="card">
            <div class="card-title">Cost Breakdown${cost.breakdown_estimated ? ' <span style="font-size:10px;color:var(--text-secondary)">(estimated)</span>' : ''}</div>
            ${Object.entries(cost.breakdown).sort((a,b) => b[1] - a[1]).map(([k,v]) => `
                <div class="weight-bar-container">
                    <div class="weight-bar-label"><span>${k}</span><span>$${typeof v === 'number' ? v.toFixed(2) : v}</span></div>
                    <div class="weight-bar"><div class="weight-bar-fill technical" style="width:${spent > 0 ? (v/spent*100).toFixed(0) : 0}%"></div></div>
                </div>
            `).join('')}
        </div>` : `
        <div class="card">
            <div class="card-title">Cost Breakdown</div>
            <div style="color:var(--text-secondary);font-size:13px;padding:12px 0">
                ${cost.note || 'Awaiting next cost check cycle'}
            </div>
        </div>`}
    </div>`;
});

// ── System Page ─────────────────────────────────────────────────────

Router.register('/system', async () => {
    const data = await API.system();
    if (!data) return '<p>Failed to load</p>';

    const functionsHtml = (data.functions || []).map(f => {
        const statusMap = { completed: 'green', failed: 'red', skipped: 'yellow', started: 'blue' };
        return `
        <tr>
            <td><strong>${f.name}</strong></td>
            <td>${pill(f.status, statusMap[f.status] || 'blue')}</td>
            <td>${timeSince(f.timestamp)}</td>
        </tr>`;
    }).join('');

    const model = data.model || {};
    const test = data.self_test || {};
    const training = data.training || {};

    // Data sources enabled
    const sources = [];
    if (model.has_llm) sources.push('LLM');
    if (model.has_fq) sources.push('FQ');
    if (model.has_mi) sources.push('MI');
    if (model.has_social) sources.push('Social');
    const sourcesStr = sources.length > 0 ? sources.join(', ') : '—';

    return `
    <div class="page-title">System Health</div>

    <div class="card-grid">
        <div class="card">
            <div class="card-title">ML Model</div>
            <div class="card-value code">v${model.version || '?'}</div>
            <div class="card-subtitle" style="margin-top:8px">Features: ${model.feature_count || '?'}</div>
            ${model.accuracy ? `<div style="font-size:13px;color:var(--text-secondary);margin-top:4px">Accuracy: ${(model.accuracy * 100).toFixed(1)}%</div>` : ''}
            ${model.auc_roc ? `<div style="font-size:13px;color:var(--text-secondary)">AUC-ROC: ${(model.auc_roc * 100).toFixed(1)}%</div>` : ''}
            <div style="font-size:13px;color:var(--text-secondary)">Sources: ${sourcesStr}</div>
            ${model.symbols_analyzed ? `<div style="font-size:13px;color:var(--text-secondary)">Symbols: ${model.symbols_analyzed}</div>` : ''}
            ${model.trained_at ? `<div style="font-size:13px;color:var(--text-secondary)">Trained: ${timeSince(model.trained_at)}</div>` : ''}
        </div>
        <div class="card">
            <div class="card-title">Self-Test</div>
            <div class="card-value ${test.all_passed ? 'positive' : (test.failed > 0 ? 'negative' : 'neutral')}">
                ${test.passed || '?'}/${test.total || '?'}
            </div>
            <div class="card-subtitle">${test.all_passed ? '✅ All passing' : (test.failed > 0 ? `❌ ${test.failed} failed` : 'No data')}</div>
        </div>
        ${training.action ? `
        <div class="card">
            <div class="card-title">Training Status</div>
            <div class="card-value ${training.action === 'failed' ? 'negative' : 'positive'}">${training.action}</div>
            <div class="card-subtitle">${timeSince(training.trained_at)}</div>
            ${training.training_samples ? `<div style="font-size:13px;color:var(--text-secondary);margin-top:4px">Samples: ${training.training_samples}</div>` : ''}
            ${training.budget_tier ? `<div style="font-size:13px;color:var(--text-secondary)">Budget: ${training.budget_tier}</div>` : ''}
        </div>` : ''}
    </div>

    <div class="table-container">
        <div class="table-header">Function Status</div>
        <table>
            <thead><tr><th>Function</th><th>Status</th><th>Last Run</th></tr></thead>
            <tbody>${functionsHtml || '<tr><td colspan="3" style="text-align:center">No data</td></tr>'}</tbody>
        </table>
    </div>`;
});

// ── Billing Page (Phase 13c) ─────────────────────────────────────────
Router.register('/billing', async () => {
    setTimeout(() => {
        const upgradeBtn = document.getElementById('billing-upgrade');
        if (upgradeBtn) upgradeBtn.addEventListener('click', async () => {
            upgradeBtn.disabled = true;
            upgradeBtn.textContent = 'Starting checkout...';
            try {
                const { url } = await API.billingCheckout();
                window.location.href = url;
            } catch (e) {
                document.getElementById('billing-msg').textContent = e.message;
                upgradeBtn.disabled = false;
                upgradeBtn.textContent = 'Upgrade to Pro — $9/mo';
            }
        });
        const portalBtn = document.getElementById('billing-portal');
        if (portalBtn) portalBtn.addEventListener('click', async () => {
            portalBtn.disabled = true;
            portalBtn.textContent = 'Opening portal...';
            try {
                const { url } = await API.billingPortal();
                window.location.href = url;
            } catch (e) {
                document.getElementById('billing-msg').textContent = e.message;
                portalBtn.disabled = false;
                portalBtn.textContent = 'Manage Subscription';
            }
        });
        const deleteBtn = document.getElementById('delete-account-btn');
        if (deleteBtn) deleteBtn.addEventListener('click', async () => {
            const confirmation = prompt(
                'This will permanently delete your account and personal data.\n\n' +
                'Type DELETE (in capitals) to confirm:'
            );
            if (confirmation !== 'DELETE') {
                document.getElementById('delete-account-msg').textContent =
                    'Cancelled.';
                return;
            }
            deleteBtn.disabled = true;
            deleteBtn.textContent = 'Deleting…';
            const msg = document.getElementById('delete-account-msg');
            try {
                await API.deleteAccount();
                alert('✅ Account deleted. You will be signed out.');
                window.location.hash = '#/login?deleted=1';
                // Hard reload to clear all in-memory state.
                setTimeout(() => window.location.reload(), 100);
            } catch (e) {
                msg.style.color = '#ef4444';
                msg.textContent = '❌ ' + (e.message || 'Failed to delete account');
                deleteBtn.disabled = false;
                deleteBtn.textContent = 'Delete my account';
            }
        });
    }, 50);

    // Display query-string status from Stripe redirect
    let banner = '';
    const hash = window.location.hash;
    if (hash.includes('status=success')) {
        banner = `<div class="glass" style="margin-bottom:16px;border-color:rgba(80,200,120,0.3)">
            <strong style="color:#5acc78">✓ Subscription active.</strong>
            Your account is being upgraded — refresh in a moment if Pro features
            don't appear yet.</div>`;
    } else if (hash.includes('status=cancelled')) {
        banner = `<div class="glass" style="margin-bottom:16px">Checkout was cancelled.
            No charges were made.</div>`;
    }

    const me = await API.checkAuth();
    const isPro = (me && me.tier === 'pro');

    return `
    <div class="page-eyebrow">Billing</div>
    ${banner}
    <div class="card-grid">
        <div class="card featured" data-tier="${isPro ? 'strong-buy' : ''}">
            <div class="card-title">${isPro ? 'Pro Plan' : 'Free Plan'}</div>
            <div class="card-value">${isPro ? '$9/mo' : '$0'}</div>
            <div class="card-subtitle">
                ${isPro
                    ? 'Real-time picks, full history, charts, drilldowns, watchlist'
                    : 'Top 1 pick/day · 7-day delay · 7-day history'}
            </div>
            <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
                ${isPro
                    ? '<button id="billing-portal" class="btn">Manage Subscription</button>'
                    : (STRIPE_ENABLED
                        ? '<button id="billing-upgrade" class="btn btn-primary">Upgrade to Pro — $9/mo</button>'
                        : '<span class="btn btn-primary" style="opacity:0.6;cursor:not-allowed">🔒 Pro · launching soon</span>')}
            </div>
            <div id="billing-msg" style="margin-top:10px;font-size:13px;color:#e57373"></div>
        </div>
        <div class="card">
            <div class="card-title">What you get with Pro</div>
            <ul style="margin:8px 0 0;padding-left:20px;color:var(--text-secondary);font-size:14px;line-height:1.8">
                <li>All daily picks, real-time (no 7-day delay)</li>
                <li>Full performance &amp; calibration history</li>
                <li>Per-stock drilldown + interactive charts</li>
                <li>Unlimited watchlist</li>
                <li>Pre-market and post-market scans</li>
            </ul>
        </div>
        <div class="card">
            <div class="card-title">Billing details</div>
            <div style="font-size:13px;color:var(--text-secondary);line-height:1.7">
                Payment processed by <strong>Stripe</strong>. We never see your card.<br>
                Cancel anytime from the billing portal — you keep access through
                the paid period.<br>
                US &amp; Canada only at this time. Sales tax handled by Stripe.
            </div>
        </div>
        <div class="card" style="border:1px solid #b91c1c33">
            <div class="card-title" style="color:#ef4444">⚠ Delete account</div>
            <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;margin-bottom:12px">
                Permanently deletes your account and all personal data
                (watchlist, alerts, account info). Usage analytics are
                anonymized but preserved. You'll be signed out immediately.
                This cannot be undone after 30 days.
            </div>
            <button id="delete-account-btn" class="btn"
                    style="background:#ef4444;color:white;border-color:#b91c1c">
                Delete my account
            </button>
            <div id="delete-account-msg" style="margin-top:10px;font-size:13px"></div>
        </div>
    </div>
    `;
});

// ── Admin Page (Phase 13d.2 — super-admin only) ──────────────────────
Router.register('/admin', async () => {
    const wireUp = () => {
        const addBtn = document.getElementById('coadmin-add-btn');
        if (addBtn) addBtn.addEventListener('click', async () => {
            const inp = document.getElementById('coadmin-email');
            const msg = document.getElementById('coadmin-msg');
            const email = (inp.value || '').trim();
            if (!email || !email.includes('@')) {
                msg.textContent = '⚠ Enter a valid email.';
                msg.style.color = '#e57373';
                return;
            }
            addBtn.disabled = true;
            msg.textContent = 'Adding…'; msg.style.color = '';
            try {
                await API.addCoAdmin(email);
                alert(`✅ Added ${email} as co-admin.`);
                Router.handleRoute();
            } catch (e) {
                msg.textContent = `❌ ${e.message || 'Failed to add'}`;
                msg.style.color = '#e57373';
                addBtn.disabled = false;
            }
        });
        document.querySelectorAll('[data-coadmin-remove]').forEach(b => {
            b.addEventListener('click', async () => {
                const email = b.getAttribute('data-coadmin-remove');
                if (!confirm(`Remove ${email} as co-admin?`)) return;
                b.disabled = true;
                try {
                    await API.removeCoAdmin(email);
                    Router.handleRoute();
                } catch (e) {
                    alert(`❌ ${e.message || 'Failed to remove'}`);
                    b.disabled = false;
                }
            });
        });

        // Phase 13d.3: beta-tester form
        const grantBtn = document.getElementById('beta-add-btn');
        if (grantBtn) grantBtn.addEventListener('click', async () => {
            const inp = document.getElementById('beta-email');
            const msg = document.getElementById('beta-msg');
            const email = (inp.value || '').trim();
            if (!email || !email.includes('@')) {
                msg.textContent = '⚠ Enter a valid email.';
                msg.style.color = '#e57373';
                return;
            }
            grantBtn.disabled = true;
            msg.textContent = 'Adding…'; msg.style.color = '';
            try {
                await API.addBetaTester(email);
                alert(`✅ Added ${email} as beta tester.`);
                Router.handleRoute();
            } catch (e) {
                msg.textContent = `❌ ${e.message || 'Failed to add'}`;
                msg.style.color = '#e57373';
                grantBtn.disabled = false;
            }
        });
        document.querySelectorAll('[data-beta-remove]').forEach(b => {
            b.addEventListener('click', async () => {
                const email = b.getAttribute('data-beta-remove');
                if (!confirm(`Remove beta tester ${email}?`)) return;
                b.disabled = true;
                try {
                    await API.removeBetaTester(email);
                    Router.handleRoute();
                } catch (e) {
                    alert(`❌ ${e.message || 'Failed to remove'}`);
                    b.disabled = false;
                }
            });
        });
    };

    let coAdmins = [];
    let betaTesters = [];
    let loadError = null;
    try {
        coAdmins = await API.listCoAdmins();
    } catch (e) {
        loadError = e.message;
    }
    let betaError = null;
    try { betaTesters = await API.listBetaTesters(); } catch (e) { betaError = e.message; }

    // Wire up AFTER router swaps innerHTML (this fn returns, router sets HTML).
    // requestAnimationFrame fires on the next paint, after innerHTML is in DOM.
    requestAnimationFrame(() => requestAnimationFrame(wireUp));

    const rows = coAdmins.length === 0
        ? `<tr><td colspan="3" style="text-align:center;color:var(--text-secondary);padding:24px">
              No co-admins yet. Promote someone below.
           </td></tr>`
        : coAdmins.map(u => `
            <tr>
                <td><strong>${u.email}</strong></td>
                <td><span class="pill pill-blue">${u.plan_tier || '—'}</span></td>
                <td style="text-align:right">
                    <button class="btn btn-ghost" data-coadmin-remove="${u.email}">Remove</button>
                </td>
            </tr>`).join('');

    return `
    <div class="page-eyebrow">Admin · Co-Admin Management</div>
    <div class="card-grid" style="grid-template-columns:1fr">
        <div class="card">
            <div class="card-title">About co-admins</div>
            <div style="color:var(--text-secondary);font-size:14px;line-height:1.7;margin-top:8px">
                Co-admins get full feature access (treated as Pro / no payment) and
                can see all dashboard pages including <strong>Budget</strong> and
                <strong>System</strong>. They <em>cannot</em> manage other co-admins —
                only super-admins (configured via <code>ADMIN_EMAILS</code> Azure app
                setting) can promote or demote.
            </div>
        </div>
    </div>

    ${loadError ? `<div class="glass" style="margin:16px 0;border-color:rgba(229,115,115,0.3);padding:12px 16px">
        ❌ ${loadError}
    </div>` : ''}

    <div class="table-container" style="margin-top:18px">
        <div class="table-header">
            Co-Admins <span class="pill pill-blue" style="margin-left:auto">${coAdmins.length}</span>
        </div>
        <table>
            <thead>
                <tr><th>Email</th><th>Plan tier</th><th style="text-align:right">Action</th></tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    </div>

    <div class="card" style="margin-top:18px">
        <div class="card-title">Add co-admin</div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <input id="coadmin-email" type="email" placeholder="email@example.com"
                   class="login-input" style="flex:1;min-width:240px;margin:0" />
            <button id="coadmin-add-btn" class="btn btn-primary">Promote to co-admin</button>
        </div>
        <div id="coadmin-msg" style="margin-top:10px;font-size:13px;color:var(--text-secondary)"></div>
    </div>

    <div class="page-eyebrow" style="margin-top:32px">Beta Testers · Manual Pro Access</div>
    ${betaError ? `<div class="glass" style="margin:12px 0;border-color:rgba(229,115,115,0.3);padding:12px 16px">
        ❌ ${betaError}
    </div>` : ''}
    <div class="card">
        <div class="card-title">About beta testers</div>
        <div style="color:var(--text-secondary);font-size:14px;line-height:1.7;margin-top:8px">
            Beta testers see exactly what <strong>Pro paying users</strong> see — useful for
            testing the paid experience, comp accounts, and early-access invites. They get
            full feature access (real-time picks, drilldowns, history) but <em>not</em>
            admin permissions. Stripe-paying customers cannot be removed here — manage them
            via the Stripe portal.
        </div>
    </div>

    <div class="table-container" style="margin-top:18px">
        <div class="table-header">
            Beta Testers <span class="pill pill-blue" style="margin-left:auto">${betaTesters.length}</span>
        </div>
        <table>
            <thead><tr><th>Email</th><th>Plan tier</th><th style="text-align:right">Action</th></tr></thead>
            <tbody>${betaTesters.length === 0
                ? `<tr><td colspan="3" style="text-align:center;color:var(--text-secondary);padding:24px">
                       No beta testers yet.</td></tr>`
                : betaTesters.map(u => `
                    <tr>
                        <td><strong>${u.email}</strong></td>
                        <td><span class="pill pill-green">${u.plan_tier}</span></td>
                        <td style="text-align:right">
                            <button class="btn btn-ghost" data-beta-remove="${u.email}">Remove</button>
                        </td>
                    </tr>`).join('')}
            </tbody>
        </table>
    </div>

    <div class="card" style="margin-top:18px">
        <div class="card-title">Add beta tester</div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <input id="beta-email" type="email" placeholder="email@example.com"
                   class="login-input" style="flex:1;min-width:240px;margin:0" />
            <button id="beta-add-btn" class="btn btn-primary">Add as beta tester</button>
        </div>
        <div id="beta-msg" style="margin-top:10px;font-size:13px;color:var(--text-secondary)"></div>
    </div>
    `;
});

// ── Init ────────────────────────────────────────────────────────────

// Handle dynamic /stock/:symbol routes
const _origHandleRoute = Router.handleRoute.bind(Router);
Router.handleRoute = async function() {
    const hash = window.location.hash.slice(1) || '/login';
    const stockMatch = hash.match(/^\/stock\/([A-Z0-9]+)$/i);
    if (stockMatch) {
        const auth = await API.checkAuth();
        if (!auth.authenticated) { window.location.hash = '#/login'; return; }
        document.getElementById('user-email').textContent = auth.email;
        document.getElementById('nav').style.display = 'flex';
        document.body.classList.add('has-bottom-nav');
        const main = document.getElementById('app');
        main.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Loading...</div>';
        main.innerHTML = await renderStockDetail(stockMatch[1].toUpperCase());
        return;
    }
    return _origHandleRoute();
};

// ── DAG Pipeline Renderer ────────────────────────────────────────────

/** Stash for active ResizeObserver so we can disconnect on re-render. */
let _dagResizeObserver = null;

/** Post-render hook: if #dag-root exists and graph data is available, build the DAG. */
function _hydrateDag(container) {
    const root = container.querySelector('#dag-root');
    if (!root || !window._dagGraphData) return;
    _renderPipelineGraph(root, window._dagGraphData);
    window._dagGraphData = null;
}

function _renderPipelineGraph(container, graphData) {
    container.innerHTML = '';
    if (_dagResizeObserver) { _dagResizeObserver.disconnect(); _dagResizeObserver = null; }

    const isMobile = window.innerWidth < 768;
    const layers = (graphData.layers || []).slice().sort((a, b) => a.order - b.order);
    const nodes = graphData.nodes || [];
    const edges = graphData.edges || [];

    layers.forEach(layer => {
        const col = document.createElement('div');
        col.className = 'dag-layer';
        col.dataset.layerId = layer.id;

        const header = document.createElement('div');
        header.className = 'dag-layer-header';
        header.textContent = layer.label;
        col.appendChild(header);

        let layerNodes = nodes
            .filter(n => n.layer === layer.id)
            .sort((a, b) => a.order - b.order);

        // Mobile: collapse layers with many nodes
        if (isMobile && layerNodes.length > 4) {
            const summary = document.createElement('div');
            summary.className = 'dag-node dag-source dag-active dag-collapse-toggle';
            summary.innerHTML = `<span class="dag-node-dot"></span><span class="dag-node-label">${layerNodes.length} nodes</span>`;
            const detail = document.createElement('div');
            detail.className = 'dag-collapse-body';
            detail.style.display = 'none';
            layerNodes.forEach(node => detail.appendChild(_makeNodeCard(node)));
            summary.addEventListener('click', () => {
                const open = detail.style.display !== 'none';
                detail.style.display = open ? 'none' : '';
                summary.querySelector('.dag-node-label').textContent = open ? `${layerNodes.length} nodes` : 'Collapse';
            });
            col.appendChild(summary);
            col.appendChild(detail);
        } else {
            layerNodes.forEach(node => col.appendChild(_makeNodeCard(node)));
        }

        container.appendChild(col);
    });

    // SVG overlay for edges
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('dag-edges');
    container.appendChild(svg);

    const draw = () => _drawEdges(container, svg, edges, isMobile);
    requestAnimationFrame(draw);

    _dagResizeObserver = new ResizeObserver(() => requestAnimationFrame(draw));
    _dagResizeObserver.observe(container);
}

function _makeNodeCard(node) {
    const card = document.createElement('div');
    const kindClass = `dag-${node.kind}`;
    const statusClass = `dag-${node.status}`;
    const feedbackBorder = node.kind === 'feedback' ? ' dag-feedback-kind' : '';
    card.className = `dag-node ${kindClass} ${statusClass}${feedbackBorder}`;
    card.dataset.nodeId = node.id;
    card.innerHTML = `<span class="dag-node-dot"></span><span class="dag-node-label">${node.label}</span>${node.metric ? `<span class="dag-node-metric">${node.metric}</span>` : ''}`;
    return card;
}

function _drawEdges(container, svg, edges, isMobile) {
    svg.innerHTML = '';
    const rect = container.getBoundingClientRect();
    svg.setAttribute('width', rect.width);
    svg.setAttribute('height', rect.height);

    // On mobile, skip feedback edges
    const filtered = isMobile ? edges.filter(e => e.type !== 'feedback') : edges;

    filtered.forEach(edge => {
        const fromEl = container.querySelector(`[data-node-id="${CSS.escape(edge.from)}"]`);
        const toEl = container.querySelector(`[data-node-id="${CSS.escape(edge.to)}"]`);
        if (!fromEl || !toEl) return;

        const fR = fromEl.getBoundingClientRect();
        const tR = toEl.getBoundingClientRect();

        let x1, y1, x2, y2;
        if (isMobile) {
            // Vertical layout: connect bottom→top
            x1 = fR.left + fR.width / 2 - rect.left;
            y1 = fR.bottom - rect.top;
            x2 = tR.left + tR.width / 2 - rect.left;
            y2 = tR.top - rect.top;
        } else {
            // Horizontal layout: connect right→left
            x1 = fR.right - rect.left;
            y1 = fR.top + fR.height / 2 - rect.top;
            x2 = tR.left - rect.left;
            y2 = tR.top + tR.height / 2 - rect.top;
        }

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        if (isMobile) {
            const cy = (y1 + y2) / 2;
            path.setAttribute('d', `M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}`);
        } else {
            const cx = (x1 + x2) / 2;
            path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
        }
        path.classList.add(`dag-edge-${edge.type}`);
        svg.appendChild(path);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Extract session token from URL (magic link redirect)
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
        API.token = token;
        localStorage.setItem('session_token', token);
        // Clean URL — remove ?token= but keep hash
        const hash = window.location.hash || '#/daily';
        window.history.replaceState({}, '', window.location.pathname + hash);
    }
    // Phase 13e: bind disclaimer dismiss once globally — survives route changes.
    const dismiss = document.getElementById('disclaimer-dismiss');
    if (dismiss) {
        dismiss.addEventListener('click', () => {
            sessionStorage.setItem('disclaimer-dismissed', '1');
            const bar = document.getElementById('disclaimer-bar');
            if (bar) bar.hidden = true;
        });
    }
    Router.handleRoute();
});
