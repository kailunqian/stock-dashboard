#!/usr/bin/env node
/**
 * Sync ?v=<version> cache-bust strings in index.html and sw.js to match
 * the CACHE_VERSION constant in sw.js (the source of truth).
 *
 * Usage:
 *   node scripts/sync-cache-bust.mjs           # rewrite files in place
 *   node scripts/sync-cache-bust.mjs --check   # exit 1 if anything is stale (no writes)
 *
 * Why: the regression-guards CI fails (and emails on every push) when
 * index.html / sw.js SHELL_FILES reference a different ?v= than
 * CACHE_VERSION. Running this before commit/push prevents the noise.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const swPath = resolve(ROOT, 'sw.js');
const htmlPath = resolve(ROOT, 'index.html');

const sw = readFileSync(swPath, 'utf-8');
const html = readFileSync(htmlPath, 'utf-8');

const m = sw.match(/CACHE_VERSION\s*=\s*['"]sa-v([\d.]+)['"]/);
if (!m) {
    console.error('❌ Could not find CACHE_VERSION constant in sw.js');
    process.exit(2);
}
const target = m[1];

const replaceVer = (src) => src.replace(/\?v=[\d.]+/g, `?v=${target}`);
const newHtml = replaceVer(html);
const newSw = replaceVer(sw);

const htmlChanged = newHtml !== html;
const swChanged = newSw !== sw;

if (CHECK_ONLY) {
    if (htmlChanged || swChanged) {
        const drifted = [htmlChanged && 'index.html', swChanged && 'sw.js']
            .filter(Boolean).join(' and ');
        console.error(
            `❌ cache-bust drift: CACHE_VERSION is sa-v${target} but ` +
            `${drifted} references a different ?v=. ` +
            `Run: node scripts/sync-cache-bust.mjs`,
        );
        process.exit(1);
    }
    console.log(`✅ cache-bust aligned at sa-v${target}`);
    process.exit(0);
}

if (!htmlChanged && !swChanged) {
    console.log(`✅ Already aligned at sa-v${target} — no changes.`);
    process.exit(0);
}

if (htmlChanged) writeFileSync(htmlPath, newHtml);
if (swChanged)   writeFileSync(swPath, newSw);

const updated = [htmlChanged && 'index.html', swChanged && 'sw.js']
    .filter(Boolean).join(' + ');
console.log(`✏️  Synced ?v= → ${target} in ${updated}.`);
