#!/usr/bin/env node
/**
 * Regression guards for the StockAnalysis dashboard.
 *
 * These mirror tests/test_auth_regression_guards.py in the StockAnalysis repo.
 * Each guard pins one invariant whose silent breakage would bounce users
 * back to the login screen after clicking a magic link.
 *
 * Run locally:   node tests/regression-guards.mjs
 * Run in CI:     .github/workflows/regression-guards.yml
 *
 * Exit code 0 = all green, 1 = at least one regression.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf-8');

const failures = [];
const fail = (name, msg) => failures.push(`❌ ${name}\n   ${msg}`);
const ok   = (name)      => console.log(`✅ ${name}`);

// ─── 1. Every cross-origin fetch must opt in to credentials ─────────────
{
    const src = read('js/api.js');
    // count `await fetch(`...`)` and `return fetch(`...`)` calls
    const fetchRe = /\b(?:await|return)\s+fetch\(`[^`]+`/g;
    const fetches = src.match(fetchRe) || [];
    const credsRe = /credentials:\s*['"]include['"]/g;
    const creds = src.match(credsRe) || [];
    if (fetches.length === 0) {
        fail('api.js fetch count', 'expected at least one fetch() in api.js');
    } else if (creds.length < fetches.length) {
        fail(
            'api.js fetch credentials',
            `found ${fetches.length} fetch() calls but only ${creds.length} ` +
            `credentials:'include' — every cross-origin fetch must opt in or ` +
            `the browser drops the auth cookie and the user is bounced to login.`,
        );
    } else {
        ok(`api.js: ${fetches.length}/${fetches.length} fetch() calls have credentials:'include'`);
    }
}

// ─── 2. /verify route handler exists (Phase 13g-5 magic-link landing) ───
{
    const src = read('js/app.js');
    if (!/['"]\/verify['"]/.test(src) || !/verifyMagicLink/.test(src)) {
        fail(
            'app.js /verify route',
            `Missing /verify route handler or verifyMagicLink call. Magic-link ` +
            `emails point at #/verify?token=XXX and the dashboard must exchange ` +
            `that token for the auth cookie via API.verifyMagicLink(token).`,
        );
    } else {
        ok('app.js: /verify route handler present');
    }
}

// ─── 3. verifyMagicLink method exists in api.js ─────────────────────────
{
    const src = read('js/api.js');
    if (!/async\s+verifyMagicLink\s*\(/.test(src)) {
        fail(
            'api.js verifyMagicLink',
            `Missing API.verifyMagicLink(token) method. Dashboard /verify route ` +
            `depends on this to exchange the magic-link token for a cookie.`,
        );
    } else if (!/Accept['"]?\s*:\s*['"]application\/json/.test(src)) {
        fail(
            'api.js verifyMagicLink Accept header',
            `verifyMagicLink must send Accept: application/json so auth_verify ` +
            `returns JSON instead of an HTML redirect page.`,
        );
    } else {
        ok('api.js: verifyMagicLink present and requests JSON');
    }
}

// ─── 4. Cache version in sw.js matches ?v= in index.html ────────────────
{
    const sw = read('sw.js');
    const html = read('index.html');

    const cacheM = sw.match(/CACHE_VERSION\s*=\s*['"]sa-v([\d.]+)['"]/);
    if (!cacheM) {
        fail('sw.js CACHE_VERSION', 'could not find CACHE_VERSION constant');
    } else {
        const cacheVer = cacheM[1];

        const versions = [...html.matchAll(/\?v=([\d.]+)/g)].map(m => m[1]);
        const stale = versions.filter(v => v !== cacheVer);
        if (stale.length > 0) {
            fail(
                'index.html cache-bust mismatch',
                `index.html references ?v=${[...new Set(stale)].join(', ')} but ` +
                `sw.js CACHE_VERSION is sa-v${cacheVer}. After a deploy, the ` +
                `service worker will serve stale JS/CSS, causing login regressions.`,
            );
        } else {
            ok(`cache-bust aligned: sa-v${cacheVer} (sw.js + ${versions.length} index.html refs)`);
        }

        const shellVers = [...sw.matchAll(/\?v=([\d.]+)/g)].map(m => m[1]);
        const shellStale = shellVers.filter(v => v !== cacheVer);
        if (shellStale.length > 0) {
            fail(
                'sw.js SHELL_FILES cache-bust mismatch',
                `sw.js SHELL_FILES references ?v=${[...new Set(shellStale)].join(', ')} ` +
                `but CACHE_VERSION is sa-v${cacheVer}.`,
            );
        }
    }
}

// ─── 5. No hardcoded API host references in landing/login flow ──────────
{
    const html = read('index.html');
    const app = read('js/app.js');
    const re = /azurewebsites\.net\/api\/auth\/verify/i;
    if (re.test(html) || re.test(app)) {
        fail(
            'no api-host verify links',
            `Found a hardcoded https://...azurewebsites.net/api/auth/verify URL ` +
            `in the dashboard. Magic links must route through #/verify on the ` +
            `dashboard host, not the API host (Chrome Safe Browsing trips on it).`,
        );
    } else {
        ok('no hardcoded api-host verify URLs');
    }
}

console.log('');

// ─── 6. Lightweight Charts wired on per-symbol drilldown (Tier 1) ───────
{
    const html = read('index.html');
    const app  = read('js/app.js');
    const sw   = read('sw.js');
    const errs = [];
    if (!/lightweight-charts/i.test(html)) {
        errs.push('index.html missing lightweight-charts script tag');
    }
    if (!/renderLwcChart\s*\(/.test(app) || !/function\s+renderLwcChart/.test(app)) {
        errs.push('app.js missing renderLwcChart helper or its invocation');
    }
    if (!/attributionLogo:\s*true/.test(app)) {
        errs.push('app.js: LWC chart must enable attributionLogo (license requirement)');
    }
    if (!/data\.history/.test(app)) {
        errs.push('app.js: renderStockDetail must consume data.history from API');
    }
    // Cache version must be bumped past the last shipped version when LWC was added (7.7).
    const m = sw.match(/CACHE_VERSION\s*=\s*['"]sa-v(\d+)\.(\d+)['"]/);
    if (!m) {
        errs.push('sw.js: CACHE_VERSION not parseable');
    } else {
        const major = parseInt(m[1], 10), minor = parseInt(m[2], 10);
        if (major < 7 || (major === 7 && minor < 8)) {
            errs.push(`sw.js: CACHE_VERSION sa-v${major}.${minor} must be ≥ sa-v7.8 (LWC shipped in 7.8)`);
        }
    }
    if (errs.length) {
        fail('LWC chart wiring (Tier 1)', errs.join('\n   '));
    } else {
        ok('LWC chart: script tag, renderLwcChart, attribution, history field, cache version all wired');
    }
}

if (failures.length > 0) {
    console.error(`\n💥 ${failures.length} regression guard(s) failed:\n`);
    for (const f of failures) console.error(f + '\n');
    process.exit(1);
}
console.log('🎉 All regression guards passed.');
