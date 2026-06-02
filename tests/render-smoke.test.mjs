#!/usr/bin/env node
/**
 * Render smoke tests for the StockAnalysis dashboard SPA.
 *
 * The regression-guards.mjs suite pins *string* invariants (a route exists,
 * a field name is referenced). These tests go one level deeper: they actually
 * execute the page render functions under jsdom with mocked API payloads and
 * assert the produced HTML, so a refactor that breaks the field->markup wiring
 * (or throws on representative data) is caught — not just one that deletes a
 * literal.
 *
 * How it works
 * ------------
 * app.js is a classic browser script: it defines `const Router` / `const API`
 * and registers each page via `Router.register(path, handler)`, where the
 * handler is an async function that RETURNS an HTML string. We load api.js +
 * app.js into a jsdom realm, expose Router/API, then invoke individual route
 * handlers with mock API methods and assert on the returned markup. No network,
 * no real DOM mutation required.
 *
 * Run:  node tests/render-smoke.test.mjs   (or: npm run test:render)
 * Exit: 0 = all green, 1 = at least one failure.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf-8');

const failures = [];
const ok = (name) => console.log(`✅ ${name}`);
const fail = (name, msg) => { failures.push(`❌ ${name}\n   ${msg}`); console.error(`❌ ${name}\n   ${msg}`); };

function assertIncludes(name, haystack, needle) {
    if (typeof haystack !== 'string') {
        fail(name, `expected a string render output, got ${typeof haystack}`);
        return false;
    }
    if (!haystack.includes(needle)) {
        fail(name, `expected output to contain ${JSON.stringify(needle)} but it did not`);
        return false;
    }
    return true;
}
function assertExcludes(name, haystack, needle) {
    if (typeof haystack === 'string' && haystack.includes(needle)) {
        fail(name, `expected output NOT to contain ${JSON.stringify(needle)} but it did`);
        return false;
    }
    return true;
}

// ── Boot a jsdom realm and load the SPA scripts into it ─────────────────
function bootDashboard() {
    const dom = new JSDOM(
        `<!DOCTYPE html><html><body>
            <div id="app"></div>
            <span id="user-email"></span>
            <nav id="nav"></nav>
            <div id="bottom-nav"></div>
            <div id="disclaimer-bar"></div>
        </body></html>`,
        { url: 'https://dash.example/', runScripts: 'outside-only', pretendToBeVisual: true },
    );
    const { window } = dom;

    // Browser globals the scripts touch (only at method-call time, but stub
    // them so nothing throws if a path is exercised).
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
    if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    }
    window.scrollTo = () => {};
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {}; };
    window.console = console;

    const context = dom.getInternalVMContext();
    // Concatenate so api.js's `const API` and app.js's `const Router` share one
    // script scope, then publish the bindings we need onto `window`.
    const code = `
        ${read('js/api.js')}
        ;
        ${read('js/app.js')}
        ;
        window.__Router = Router;
        window.__API = API;
        window.__renderStockDetail = (typeof renderStockDetail === 'function') ? renderStockDetail : null;
        window.__renderMlHealthTile = (typeof renderMlHealthTile === 'function') ? renderMlHealthTile : null;
    `;
    vm.runInContext(code, context, { filename: 'dashboard-bundle.js' });
    return { window, Router: window.__Router, API: window.__API, renderStockDetail: window.__renderStockDetail };
}

// ── Mock payload factories (shape mirrors src/http/dashboard_routes.py) ──
const isoNow = () => new Date().toISOString();

function dailyData(overrides = {}) {
    return {
        scan: {
            scanned_at: isoNow(),
            stocks_scanned: 150,
            actionable: 6,
            top_pick: 'NVDA',
            top_score: 88,
            top_picks: [
                { symbol: 'NVDA', recommendation: 'Strong Buy', score: 88, buy_price: 100, target_short: 120, stop_loss: 90, score_breakdown: {} },
            ],
            market_regime: { regime: 'bull', description: 'Risk-on tape', vix: 14 },
        },
        training: {},
        model: { version: '1.2.0', accuracy: 0.61 },
        conviction: [{ symbol: 'NVDA', appearances: 3, actionable_count: 2, latest_score: 88, trend: 'up' }],
        daily_ml_activity: {
            overall_status: 'healthy',
            summary_line: '🟢 ML healthy — 5/5 loops fresh',
            full_retrain: { friendly_status: 'last ran 3d ago' },
            incremental_update: { friendly_status: 'ran after today\'s scan' },
            daily_loops: [
                { label: 'Sentiment refresh', ok: true, fresh: true, friendly_status: 'ran 2h ago' },
                { label: 'Feature rebuild', ok: true, fresh: false, friendly_status: 'ran 20h ago' },
            ],
        },
        fusion: {
            available: true,
            snapshot_date: '2026-06-01',
            absolute_threshold: 75,
            rank_threshold: 0.9,
            tier_counts: { 'Strong Buy': 1, 'Watchlist Promotion': 1 },
            tiers: {
                'Strong Buy': [
                    { symbol: 'NVDA', composite_score: 88, cross_sectional_rank: 0.95, in_focused_universe: true, in_sp500: true, abs_pass: true, rank_pass: true },
                ],
            },
            watchlist_promotions: [
                { symbol: 'AMD', composite_score: 71, cross_sectional_rank: 0.92, in_focused_universe: false, in_sp500: true, abs_pass: false, rank_pass: true },
            ],
        },
        ...overrides,
    };
}

function systemData(overrides = {}) {
    return {
        functions: [],
        scheduled_jobs: [],
        model: { version: '1.2.0', feature_count: 72, has_llm: true, has_social: true },
        self_test: { passed: 5, total: 5, all_passed: true },
        training: {},
        phase_e_verdict: null,
        data_health: { tracked_symbols: 1000, candidates: 0, fast_skip_active: 0 },
        ml_health: {
            lookback_days: 14,
            runtime_flags: { ADAPTIVE_ML_ENABLED: true, ADAPTIVE_ML_KILL_SWITCH: false },
            config_flags: { ml_buy_union_enabled: true },
            champion_model: { present: true, version: '5', auc: 0.612, trained_at: isoNow() },
            db_coverage: { champion_p_hit_coverage_pct: 42, champion_p_hit_non_null: 21, predictions_total: 50 },
            diagnosis: 'Healthy: champion_p_hit coverage 42% and ml_buy_union enabled.',
        },
        ...overrides,
    };
}

function performanceData(overrides = {}) {
    return {
        scorecard: { scorecards: { all: { total_picks: 10, hit_rate: 0.6, winners: 6, losers: 4, avg_return: 0.03, cumulative_return: 0.3, strong_buy_count: 0, buy_count: 0, high_conf_picks: 0 } } },
        model_metrics: { version: '1.2.0', accuracy: 0.61, auc_roc: 0.62, feature_count: 72, symbols_analyzed: 100, has_llm: true, has_social: true, metrics: { precision: 0.58, recall: 0.55 } },
        scorer_state: {},
        training_status: {},
        accuracy_breakdown: {
            backtest: { total: 80, with_outcomes: 70, hit_rate: 0.55 },
            live: { total: 20, with_outcomes: 12, hit_rate: 0.58 },
            combined: { total: 100, hit_rate: 0.56 },
        },
        recent_picks: [],
        conviction: [],
        strategies: [],
        signal_accuracy: {},
        walk_forward: { status: 'none' },
        prediction_activity: {},
        pending_predictions: [],
        ...overrides,
    };
}

function pipelineData(overrides = {}) {
    // /pipeline reads API.daily()'s `pipeline` (+ scan/model) surface.
    return dailyData({
        pipeline: {
            sources: [{ name: 'Yahoo', type: 'market' }, { name: 'News', type: 'news' }],
            stocks_fetched: 150,
            features: { total: 72, groups: [{ name: 'Technical', count: 25 }, { name: 'Fundamental', count: 15 }] },
            strategies: [
                { abbr: 'MOM', status: 'active', focus: 'Momentum', name: 'Momentum' },
                { abbr: 'VAL', status: 'shadow' },
            ],
            strategy_counts: { active: 1 },
            model: { accuracy: 0.61, components: ['GBM', 'RF'], samples: 12000 },
            scoring: { weights: { technical: 0.3, ml: 0.25, fundamental: 0.2 }, threshold: 75 },
            output: { picks: 6, top_pick: 'NVDA', top_score: 88, delivery: ['Telegram', 'Dashboard'] },
        },
        ...overrides,
    });
}

function diagnosticsData(overrides = {}) {
    return {
        totals: { scanned: 450, high_conviction: 2, near_miss: 5 },
        per_day: { '2026-06-01': { scanned: 150, high_conviction: 2, near_miss: 5 } },
        high_conviction_today: [
            { symbol: 'NVDA', score: 88.5, n_signals: 4, signals: ['breakout', 'catalyst', 'momentum'] },
        ],
        near_miss_today: [
            { symbol: 'EOG', score: 74.2, n_signals: 2, gates: { score_pass: true, signals_pass: false, no_hard_risks: true }, fail_reasons: ['no catalyst', 'thin breakout'] },
        ],
        ...overrides,
    };
}

function v2ShadowData(overrides = {}) {
    return {
        days_window: 7,
        scoring_v2_enforce: false,
        totals: { legacy_strong_buy: 1, legacy_buy: 3, v2_strong_buy: 1, v2_buy: 2, v2_only: 1, agree_buy_or_above: 2, legacy_only: 2 },
        v2_only_picks: [
            { date: '2026-06-01', symbol: 'AMD', legacy_score: 68, v2_tier: 'Buy', v2_path: 'catalyst', catalyst_score: 3, signals: ['earnings', 'breakout'] },
        ],
        ...overrides,
    };
}

function stockDetailData(overrides = {}) {
    return {
        symbol: 'NVDA',
        recommendation: 'Strong Buy',
        recommendation_emoji: '🔥',
        composite_score: 88,
        current_price: 102.5,
        buy_price: 100,
        target_short: 120,
        target_long: 140,
        stop_loss: 90,
        signals: ['breakout', 'volume surge'],
        risks: [],
        ml_status: 'champion',
        scores: {
            technical: { value: 85, weight: 0.3 },
            fundamental: { value: 70, weight: 0.2 },
            momentum: { value: 90, weight: 0.2 },
            news: { value: 65, weight: 0.15 },
            strategy: { value: 80, weight: 0.15 },
        },
        weighted_contributions: { technical: 25.5, fundamental: 14, momentum: 18, news: 9.75, strategy: 12 },
        macro_narrative_delta: 1.4,
        macro_narrative_breakdown: ['AI demand: +1.2', 'Rates: -0.3'],
        reasoning: 'Strong technical breakout with supportive AI-demand macro tailwind.',
        history: [
            { time: '2026-05-30', open: 98, high: 103, low: 97, close: 101, volume: 1000000 },
            { time: '2026-05-31', open: 101, high: 104, low: 100, close: 102.5, volume: 1200000 },
        ],
        ...overrides,
    };
}

// ── Tests ───────────────────────────────────────────────────────────────
async function main() {
    let Router, API, renderStockDetail, window;
    try {
        ({ window, Router, API, renderStockDetail } = bootDashboard());
    } catch (e) {
        fail('boot dashboard bundle', `failed to load api.js + app.js under jsdom:\n   ${e.stack || e}`);
        finish();
        return;
    }

    const handler = (path) => {
        const h = Router && Router.routes && Router.routes[path];
        if (typeof h !== 'function') throw new Error(`no route handler registered for ${path}`);
        return h;
    };

    // 1) Daily — Buy-Tier Fusion panel renders from data.fusion
    try {
        API.daily = async () => dailyData();
        API.macro = async () => ({ enabled: false, themes: [] });
        const html = await handler('/daily')();
        const a = assertIncludes('daily: fusion panel heading', html, 'Buy-Tier Fusion');
        const b = assertIncludes('daily: fusion tier table', html, 'Strong Buy');
        const c = assertIncludes('daily: fusion promotion row', html, 'AMD');
        const d = assertIncludes('daily: fusion symbol row', html, 'NVDA');
        if (a && b && c && d) ok('daily: Buy-Tier Fusion panel renders tiers + promotions from data.fusion');
        // Decluttering (2026-06-02): ML Activity panel + ML Model KPI card were
        // relocated/removed; assert they no longer appear on the Daily tab even
        // though daily_ml_activity is still present in the payload.
        const e = assertExcludes('daily: ML Activity panel relocated to System', html, 'ML Activity (last 24h)');
        const f = assertExcludes('daily: ML Model KPI card removed', html, '>ML Model<');
        if (e && f) ok('daily: ML-ops cruft (ML Activity panel + ML Model card) removed from Daily');
    } catch (e) { fail('daily render', e.stack || String(e)); }

    // 1b) Daily — fusion hidden when unavailable (graceful empty state)
    try {
        API.daily = async () => dailyData({ fusion: { available: false } });
        API.macro = async () => ({ enabled: false, themes: [] });
        const html = await handler('/daily')();
        if (assertExcludes('daily: fusion hidden when unavailable', html, 'Buy-Tier Fusion')) {
            ok('daily: fusion panel omitted when fusion.available is false');
        }
    } catch (e) { fail('daily render (no fusion)', e.stack || String(e)); }

    // 2) System — ML Buy-Path Health tile renders from data.ml_health
    try {
        API.system = async () => systemData();
        API.incidents = async () => ({ open: [], resolved_recent: [] });
        API.daily = async () => dailyData();
        const html = await handler('/system')();
        const a = assertIncludes('system: ml-health tile heading', html, 'ML Buy-Path Health');
        const b = assertIncludes('system: ml-health coverage value', html, '42%');
        const c = assertIncludes('system: ml-health live badge', html, 'LIVE');
        const d = assertIncludes('system: ml-health tile id', html, 'id="ml-health-tile"');
        const e = assertIncludes('system: ml-health lookback selector', html, '_reloadMlHealth(30)');
        if (a && b && c && d && e) ok('system: ML Buy-Path Health tile renders coverage + diagnosis + lookback selector from data.ml_health');
        const f = assertIncludes('system: ML Activity panel relocated here', html, 'ML Activity (last 24h)');
        const g = assertIncludes('system: ML Activity loop row', html, 'Sentiment refresh');
        if (f && g) ok('system: ML Activity (last 24h) panel renders from daily_ml_activity (relocated from Daily)');
    } catch (e) { fail('system render', e.stack || String(e)); }

    // 2c) System — lookback selector refetches via API.mlStatus and swaps the tile
    try {
        window.document.body.innerHTML = `<div id="app">${window.__renderMlHealthTile({
            lookback_days: 14,
            runtime_flags: { ADAPTIVE_ML_ENABLED: true, ADAPTIVE_ML_KILL_SWITCH: false },
            config_flags: { ml_buy_union_enabled: true },
            champion_model: { present: true, version: '5', auc: 0.61 },
            db_coverage: { champion_p_hit_coverage_pct: 42, champion_p_hit_non_null: 21, predictions_total: 50 },
            diagnosis: 'ok',
        })}</div>`;
        let askedDays = null;
        API.mlStatus = async (days) => {
            askedDays = days;
            return {
                lookback_days: days,
                runtime_flags: { ADAPTIVE_ML_ENABLED: true, ADAPTIVE_ML_KILL_SWITCH: false },
                config_flags: { ml_buy_union_enabled: true },
                champion_model: { present: true, version: '5', auc: 0.61 },
                db_coverage: { champion_p_hit_coverage_pct: 37, champion_p_hit_non_null: 60, predictions_total: 160 },
                diagnosis: 'ok',
            };
        };
        await window._reloadMlHealth(90);
        const swapped = window.document.getElementById('ml-health-tile').outerHTML;
        const a = askedDays === 90 ? ok('system: lookback selector calls API.mlStatus(90)') : fail('system: lookback selector days', `expected 90, got ${askedDays}`);
        const b = assertIncludes('system: reloaded tile window', swapped, 'last 90d');
        const c = assertIncludes('system: reloaded tile coverage', swapped, '37%');
        if (b && c) ok('system: ML Buy-Path Health tile is refetched + swapped in place for a new lookback window');
    } catch (e) { fail('system render (ml-status reload)', e.stack || String(e)); }

    // 2b) System — degraded ML health flips badge to CHECK
    try {
        API.system = async () => systemData({
            ml_health: {
                lookback_days: 14,
                runtime_flags: { ADAPTIVE_ML_ENABLED: false, ADAPTIVE_ML_KILL_SWITCH: false },
                config_flags: { ml_buy_union_enabled: false },
                champion_model: { present: false },
                db_coverage: { champion_p_hit_coverage_pct: 0, champion_p_hit_non_null: 0, predictions_total: 30 },
                diagnosis: 'ADAPTIVE_ML_ENABLED is not true — champion_p_hit is NULL.',
            },
        });
        API.incidents = async () => ({ open: [], resolved_recent: [] });
        const html = await handler('/system')();
        if (assertIncludes('system: ml-health degraded badge', html, 'CHECK')) {
            ok('system: ML Buy-Path Health shows CHECK when the buy path is not live');
        }
    } catch (e) { fail('system render (degraded ml_health)', e.stack || String(e)); }

    // 3) Performance — Live vs Backtest accuracy card from accuracy_breakdown
    try {
        API.performance = async () => performanceData();
        const html = await handler('/performance')();
        const a = assertIncludes('performance: accuracy card heading', html, 'Live vs Backtest');
        const b = assertIncludes('performance: live segment label', html, 'Live (forward picks)');
        const c = assertIncludes('performance: backtest segment label', html, 'Backtest');
        if (a && b && c) ok('performance: Live-vs-Backtest accuracy card renders from data.accuracy_breakdown');
        const d = assertIncludes('performance: feature-source label', html, 'Feature sources');
        const e = assertIncludes('performance: feature-source pill (LLM)', html, '>LLM<');
        const f = assertIncludes('performance: feature-source pill (Social)', html, '>Social<');
        const g = assertIncludes('performance: extra training metric', html, 'precision');
        if (d && e && f && g) ok('performance: ML Model Performance card surfaces model_metrics.has_* feature sources + extra metrics');
    } catch (e) { fail('performance render', e.stack || String(e)); }

    // 4) Pipeline — analysis flow renders from API.daily().pipeline
    try {
        API.daily = async () => pipelineData();
        const html = await handler('/pipeline')();
        const a = assertIncludes('pipeline: page title', html, 'Analysis Pipeline');
        const b = assertIncludes('pipeline: data sources stage', html, 'Data Sources');
        const c = assertIncludes('pipeline: ml ensemble stage', html, 'ML Ensemble');
        const d = assertIncludes('pipeline: top picks stage', html, 'Top Picks');
        if (a && b && c && d) ok('pipeline: analysis-flow stages render from data.pipeline');
    } catch (e) { fail('pipeline render', e.stack || String(e)); }

    // 5) Diagnostics — near-miss + v2 shadow render from diagnostics/v2 payloads
    try {
        API.diagnostics = async () => diagnosticsData();
        API.v2ShadowSummary = async () => v2ShadowData();
        const html = await handler('/diagnostics')();
        const a = assertIncludes('diagnostics: page title', html, 'Near-Miss Analysis');
        const b = assertIncludes('diagnostics: high-conviction row', html, 'NVDA');
        const c = assertIncludes('diagnostics: near-miss row', html, 'EOG');
        const d = assertIncludes('diagnostics: v2 shadow section', html, 'v2 Conviction Shadow');
        const e2 = assertIncludes('diagnostics: v2-only pick', html, 'AMD');
        if (a && b && c && d && e2) ok('diagnostics: near-miss tables + v2 shadow section render');
    } catch (e) { fail('diagnostics render', e.stack || String(e)); }

    // 5b) Diagnostics — v2 section omitted when shadow summary unavailable
    try {
        API.diagnostics = async () => diagnosticsData();
        API.v2ShadowSummary = async () => null;
        const html = await handler('/diagnostics')();
        if (assertExcludes('diagnostics: v2 omitted when null', html, 'v2 Conviction Shadow')) {
            ok('diagnostics: v2 shadow section omitted when summary is unavailable');
        }
    } catch (e) { fail('diagnostics render (no v2)', e.stack || String(e)); }

    // 6) Stock detail — per-symbol drilldown renders from API.stock(symbol)
    try {
        if (typeof renderStockDetail !== 'function') throw new Error('renderStockDetail not exposed from bundle');
        API.stock = async () => stockDetailData();
        const html = await renderStockDetail('NVDA');
        const a = assertIncludes('stock: title with recommendation', html, 'NVDA — Strong Buy');
        const b = assertIncludes('stock: composite score card', html, 'Composite Score');
        const c = assertIncludes('stock: decision flow', html, 'Decision Flow');
        const d = assertIncludes('stock: macro impact (macro_narrative_delta)', html, 'Macro Impact');
        const e2 = assertIncludes('stock: AI reasoning', html, 'AI Reasoning');
        const f = assertIncludes('stock: price chart from history', html, 'Price Chart');
        if (a && b && c && d && e2 && f) ok('stock detail: scores, decision flow, macro impact, chart + reasoning render');
    } catch (e) { fail('stock detail render', e.stack || String(e)); }

    finish();
}

function finish() {
    console.log('');
    if (failures.length > 0) {
        console.error(`💥 ${failures.length} render smoke test(s) failed.\n`);
        process.exit(1);
    }
    console.log('🎉 All render smoke tests passed.');
}

main();
