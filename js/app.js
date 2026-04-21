/* StockAnalysis Dashboard — SPA Router + Page Renderers */

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

        // Auth check (skip for login)
        if (path !== '/login') {
            const auth = await API.checkAuth();
            if (!auth.authenticated) {
                window.location.hash = '#/login';
                return;
            }
            document.getElementById('user-email').textContent = auth.email;
            document.getElementById('nav').style.display = 'flex';
        } else {
            document.getElementById('nav').style.display = 'none';
        }

        // Highlight active nav
        document.querySelectorAll('.nav-links a').forEach(a => {
            a.classList.toggle('active', a.getAttribute('href') === `#${path}`);
        });

        const handler = this.routes[path];
        const main = document.getElementById('app');
        if (handler) {
            main.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Loading...</div>';
            try {
                main.innerHTML = await handler();
            } catch (e) {
                main.innerHTML = `<div class="card" style="margin:40px auto;max-width:500px;text-align:center">
                    <h3>⚠️ Error</h3><p style="color:var(--text-secondary)">${e.message}</p></div>`;
            }
        } else {
            main.innerHTML = '<div class="card" style="margin:40px auto;max-width:500px;text-align:center"><h3>Page not found</h3></div>';
        }
    }
};

window.addEventListener('hashchange', () => Router.handleRoute());

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
        const form = document.getElementById('login-form');
        if (form) form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const btn = document.getElementById('login-btn');
            const msg = document.getElementById('login-msg');
            btn.disabled = true;
            btn.textContent = 'Sending...';
            try {
                const result = await API.login(email);
                msg.className = 'login-message';
                msg.textContent = '✉️ Check your email for a login link!';
            } catch (e) {
                msg.className = 'login-message login-error';
                msg.textContent = 'Failed to send. Try again.';
            }
            btn.disabled = false;
            btn.textContent = 'Send Login Link';
        });
    }, 50);

    return `
    <div class="login-container">
        <div class="login-box">
            <h1>📊 StockAnalysis</h1>
            <p>Enter your email to receive a login link</p>
            <form id="login-form">
                <input type="email" id="login-email" class="login-input" placeholder="your@email.com" required />
                <button type="submit" id="login-btn" class="btn btn-primary">Send Login Link</button>
            </form>
            <div id="login-msg" class="login-message"></div>
        </div>
    </div>`;
});

// ── Daily Report Page ───────────────────────────────────────────────

Router.register('/daily', async () => {
    const data = await API.daily();
    if (!data) return '<p>Failed to load</p>';

    const scan = data.scan || {};
    const training = data.training || {};

    let picksHtml = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary)">No recent scan data</td></tr>';
    if (scan.top_picks && scan.top_picks.length > 0) {
        picksHtml = scan.top_picks.map(p => `
            <tr onclick="window.location.hash='#/stock/${p.symbol}'" style="cursor:pointer">
                <td><strong>${p.symbol}</strong></td>
                <td>${recPill(p.recommendation)}</td>
                <td>${p.score?.toFixed(0) || '—'}</td>
                <td>$${p.current_price?.toFixed(2) || '—'}</td>
                <td>$${p.target_short?.toFixed(2) || '—'}</td>
                <td>${(p.signals || []).slice(0, 3).join(', ') || '—'}</td>
            </tr>
        `).join('');
    }

    return `
    <div class="page-title">📊 Daily Report</div>

    <div class="card-grid">
        <div class="card">
            <div class="card-title">Stocks Scanned</div>
            <div class="card-value neutral">${scan.stocks_scanned || '—'}</div>
            <div class="card-subtitle">${timeSince(scan.scanned_at)}</div>
        </div>
        <div class="card">
            <div class="card-title">Buy Signals</div>
            <div class="card-value positive">${scan.actionable || 0}</div>
            <div class="card-subtitle">Score ≥ 75</div>
        </div>
        <div class="card">
            <div class="card-title">Top Pick</div>
            <div class="card-value neutral">${scan.top_pick || '—'}</div>
            <div class="card-subtitle">Score: ${scan.top_score?.toFixed(0) || '—'}</div>
        </div>
        <div class="card">
            <div class="card-title">ML Model</div>
            <div class="card-value neutral">${training.model_version || '—'}</div>
            <div class="card-subtitle">${timeSince(training.last_retrain)}</div>
        </div>
    </div>

    <div class="table-container">
        <div class="table-header">Today's Recommendations</div>
        <table>
            <thead>
                <tr>
                    <th>Symbol</th><th>Rating</th><th>Score</th>
                    <th>Price</th><th>Target</th><th>Signals</th>
                </tr>
            </thead>
            <tbody>${picksHtml}</tbody>
        </table>
    </div>`;
});

// ── Performance Page ────────────────────────────────────────────────

Router.register('/performance', async () => {
    const data = await API.performance();
    if (!data) return '<p>Failed to load</p>';

    const sc = data.scorecard?.scorecards || {};
    const card = sc.all || sc['30d'] || {};

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
                <div class="weight-bar-label"><span>🟢🟢 Strong Buy</span><span>${(allCard.strong_buy_hit_rate*100).toFixed(0)}% (${allCard.strong_buy_count})</span></div>
                <div class="weight-bar"><div class="weight-bar-fill technical" style="width:${allCard.strong_buy_hit_rate*100}%"></div></div>
            </div>` : ''}
            ${allCard.buy_count > 0 ? `
            <div class="weight-bar-container">
                <div class="weight-bar-label"><span>🟢 Buy</span><span>${(allCard.buy_hit_rate*100).toFixed(0)}% (${allCard.buy_count})</span></div>
                <div class="weight-bar"><div class="weight-bar-fill fundamental" style="width:${allCard.buy_hit_rate*100}%"></div></div>
            </div>` : ''}
            ${allCard.high_conf_picks > 0 ? `
            <div class="weight-bar-container">
                <div class="weight-bar-label"><span>🎯 High Conf (≥75)</span><span>${(allCard.high_conf_hit_rate*100).toFixed(0)}% (${allCard.high_conf_picks})</span></div>
                <div class="weight-bar"><div class="weight-bar-fill momentum" style="width:${allCard.high_conf_hit_rate*100}%"></div></div>
            </div>` : ''}
        </div>`;
    }

    return `
    <div class="page-title">📈 Performance</div>
    <div class="card-grid">
        ${scorecardCard('7d', sc['7d'])}
        ${scorecardCard('30d', sc['30d'])}
        ${scorecardCard('all', sc.all)}
        ${calibrationHtml}
    </div>`;
});

// ── Stock Detail Page (Decision Flow) ───────────────────────────────

Router.register('/stock', async () => {
    return `<div class="card" style="text-align:center;padding:40px">
        <p>Enter a stock symbol in the URL: <code>#/stock/NVDA</code></p>
    </div>`;
});

// Dynamic stock route handler
async function renderStockDetail(symbol) {
    const data = await API.stock(symbol);
    if (!data || data.error) return `<div class="card"><p>❌ ${data?.error || 'Failed to load'}</p></div>`;

    const scores = data.scores || {};
    const contribs = data.weighted_contributions || {};

    // Build flow pipeline
    const stages = [
        { label: 'Technical', value: scores.technical?.value?.toFixed(0), weight: scores.technical?.weight, class: 'technical' },
        { label: 'Fundamental', value: scores.fundamental?.value?.toFixed(0), weight: scores.fundamental?.weight, class: 'fundamental' },
        { label: 'Momentum', value: scores.momentum?.value?.toFixed(0), weight: scores.momentum?.weight, class: 'momentum' },
        { label: 'News', value: scores.news?.value?.toFixed(0), weight: scores.news?.weight, class: 'news' },
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
            <div class="card-value neutral">$${data.current_price?.toFixed(2)}</div>
        </div>
        <div class="card">
            <div class="card-title">Target (Short)</div>
            <div class="card-value positive">$${data.target_short?.toFixed(2) || '—'}</div>
        </div>
        <div class="card">
            <div class="card-title">Stop Loss</div>
            <div class="card-value negative">$${data.stop_loss?.toFixed(2) || '—'}</div>
        </div>
    </div>

    <div class="flow-container">
        <div class="flow-title">📐 Decision Flow — How This Score Was Made</div>
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
    <div class="page-title">💰 Budget</div>
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
        ${cost.breakdown ? `
        <div class="card">
            <div class="card-title">Cost Breakdown</div>
            ${Object.entries(cost.breakdown).map(([k,v]) => `
                <div class="weight-bar-container">
                    <div class="weight-bar-label"><span>${k}</span><span>$${v.toFixed(2)}</span></div>
                    <div class="weight-bar"><div class="weight-bar-fill technical" style="width:${(v/spent*100).toFixed(0)}%"></div></div>
                </div>
            `).join('')}
        </div>` : ''}
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

    return `
    <div class="page-title">🔧 System Health</div>

    <div class="card-grid">
        <div class="card">
            <div class="card-title">ML Model</div>
            <div class="card-value neutral">v${model.version || '?'}</div>
            <div class="card-subtitle">Features: ${model.feature_count || '?'}</div>
        </div>
        <div class="card">
            <div class="card-title">Self-Test</div>
            <div class="card-value ${test.all_passed ? 'positive' : (test.failed > 0 ? 'negative' : 'neutral')}">
                ${test.passed || '?'}/${test.total || '?'}
            </div>
            <div class="card-subtitle">${test.all_passed ? '✅ All passing' : `❌ ${test.failed} failed`}</div>
        </div>
    </div>

    <div class="table-container">
        <div class="table-header">Function Status</div>
        <table>
            <thead><tr><th>Function</th><th>Status</th><th>Last Run</th></tr></thead>
            <tbody>${functionsHtml || '<tr><td colspan="3" style="text-align:center">No data</td></tr>'}</tbody>
        </table>
    </div>`;
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
        const main = document.getElementById('app');
        main.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Loading...</div>';
        main.innerHTML = await renderStockDetail(stockMatch[1].toUpperCase());
        return;
    }
    return _origHandleRoute();
};

document.addEventListener('DOMContentLoaded', () => Router.handleRoute());
