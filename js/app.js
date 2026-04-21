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
                msg.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Check your email for a login link';
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
            <div class="login-logo">
                <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </div>
            <h1>StockAnalysis</h1>
            <p>Sign in with a magic link sent to your email</p>
            <form id="login-form">
                <input type="email" id="login-email" class="login-input" placeholder="you@example.com" required />
                <button type="submit" id="login-btn" class="btn btn-primary">Continue with Email</button>
            </form>
            <div id="login-msg" class="login-message"></div>
            <div class="login-footer">Secured with token-based authentication</div>
        </div>
    </div>`;
});

// ── Daily Report Page ───────────────────────────────────────────────

Router.register('/daily', async () => {
    const data = await API.daily();
    if (!data) return '<p>Failed to load</p>';

    const scan = data.scan || {};
    const training = data.training || {};
    const model = data.model || {};

    let picksHtml = '';
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
    } else if (scan.stocks_scanned) {
        picksHtml = `<tr><td colspan="6" style="text-align:center;color:var(--text-secondary)">
            No buy signals today — ${scan.stocks_scanned} stocks scanned${scan.top_pick ? `, top: ${scan.top_pick}` : ''}
        </td></tr>`;
    } else {
        picksHtml = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary)">No recent scan data</td></tr>';
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

    // Build animated pipeline data from real scan results
    const scanned = scan.stocks_scanned || '~150';
    const features = model.feature_count || 72;
    const accuracy = model.accuracy ? `${(model.accuracy * 100).toFixed(0)}%` : '—';
    const actionable = scan.actionable || 0;
    const topPicks = scan.top_picks?.length || actionable;

    // SVG icons for each stage
    const icons = {
        source: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 4.03 2 6.5v11C2 19.97 6.48 22 12 22s10-2.03 10-4.5v-11C22 4.03 17.52 2 12 2z"/><ellipse cx="12" cy="6.5" rx="10" ry="4.5"/></svg>',
        feature: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
        strategy: '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
        model: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>',
        score: '<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
        filter: '<svg viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
        output: '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    };

    const connector = `<div class="pipeline-connector"><div class="pipeline-dot d1"></div><div class="pipeline-dot d2"></div></div>`;

    const pipelineHtml = `
    <div class="pipeline-container">
        <div class="pipeline-header">
            <span class="pipeline-live"></span> Analysis Pipeline
            ${scan.scanned_at ? `<span style="margin-left:auto;font-size:11px">Last run: ${timeSince(scan.scanned_at)}</span>` : ''}
        </div>
        <div class="pipeline">
            <div class="pipeline-stage active" style="animation-delay:0s">
                <div class="pipeline-stage-icon source">${icons.source}</div>
                <div class="pipeline-stage-value">7</div>
                <div class="pipeline-stage-label">Data Sources</div>
                <div class="pipeline-stage-detail">Yahoo, News, Social...</div>
            </div>
            ${connector}
            <div class="pipeline-stage active" style="animation-delay:0.15s">
                <div class="pipeline-stage-icon feature">${icons.feature}</div>
                <div class="pipeline-stage-value">${scanned}</div>
                <div class="pipeline-stage-label">Stocks Fetched</div>
                <div class="pipeline-stage-detail">Discovery + Watchlist</div>
            </div>
            ${connector}
            <div class="pipeline-stage active" style="animation-delay:0.3s">
                <div class="pipeline-stage-icon strategy">${icons.strategy}</div>
                <div class="pipeline-stage-value">${features}</div>
                <div class="pipeline-stage-label">Features</div>
                <div class="pipeline-stage-detail">Tech + Fund + LLM + MI</div>
            </div>
            ${connector}
            <div class="pipeline-stage active" style="animation-delay:0.45s">
                <div class="pipeline-stage-icon model">${icons.model}</div>
                <div class="pipeline-stage-value">4</div>
                <div class="pipeline-stage-label">Strategies</div>
                <div class="pipeline-stage-detail">Mom · Val · Brk · Acc</div>
            </div>
            ${connector}
            <div class="pipeline-stage active" style="animation-delay:0.6s">
                <div class="pipeline-stage-icon score">${icons.score}</div>
                <div class="pipeline-stage-value">${accuracy}</div>
                <div class="pipeline-stage-label">ML Ensemble</div>
                <div class="pipeline-stage-detail">GBM + RF + LR</div>
            </div>
            ${connector}
            <div class="pipeline-stage active" style="animation-delay:0.75s">
                <div class="pipeline-stage-icon filter">${icons.filter}</div>
                <div class="pipeline-stage-value">≥75</div>
                <div class="pipeline-stage-label">Score Filter</div>
                <div class="pipeline-stage-detail">Buy threshold</div>
            </div>
            ${connector}
            <div class="pipeline-stage active" style="animation-delay:0.9s">
                <div class="pipeline-stage-icon output">${icons.output}</div>
                <div class="pipeline-stage-value">${topPicks}</div>
                <div class="pipeline-stage-label">Top Picks</div>
                <div class="pipeline-stage-detail">${scan.top_pick ? `Best: ${scan.top_pick}` : 'Ranked by score'}</div>
            </div>
        </div>
    </div>`;

    return `
    <div class="page-title">Daily Report</div>

    ${pipelineHtml}

    <div class="card-grid">
        <div class="card">
            <div class="card-title">Stocks Scanned</div>
            <div class="card-value neutral">${scan.stocks_scanned || '—'}</div>
            <div class="card-subtitle">${timeSince(scan.scanned_at)}</div>
            ${scan.elapsed ? `<div style="font-size:13px;color:var(--text-secondary)">Elapsed: ${scan.elapsed.toFixed(1)}s</div>` : ''}
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
            <div class="card-value neutral">${model.version || training.model_version || '—'}</div>
            <div class="card-subtitle">${model.accuracy ? `Accuracy: ${(model.accuracy * 100).toFixed(1)}%` : timeSince(training.trained_at)}</div>
        </div>
        ${trainingHtml}
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

    // Empty state message
    let emptyHtml = '';
    if (!hasScorecardData) {
        emptyHtml = `
        <div class="card" style="text-align:center;grid-column:1/-1">
            <div style="font-size:16px;margin-bottom:8px">Prediction Performance</div>
            <p style="color:var(--text-secondary)">Performance tracking starts after 7 days of predictions. Scorecard data will appear here once outcomes are recorded.</p>
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
    ${strategyHtml}
    ${hasScorecardData || emptyHtml ? '<div style="font-size:14px;color:var(--text-secondary);margin:16px 0 8px">Prediction Scorecard</div>' : ''}
    <div class="card-grid">
        ${hasScorecardData ? `
            ${scorecardCard('7d', sc['7d'])}
            ${scorecardCard('30d', sc['30d'])}
            ${scorecardCard('all', sc.all)}
            ${calibrationHtml}
        ` : emptyHtml}
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
            <div class="card-value neutral">v${model.version || '?'}</div>
            <div class="card-subtitle">Features: ${model.feature_count || '?'}</div>
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
    Router.handleRoute();
});
