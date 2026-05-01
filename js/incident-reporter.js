/* StockAnalysis Dashboard — anonymous incident reporter.
 *
 * Loaded FIRST in <head>, before any other script. Solves the
 * circular-observability problem: when the dashboard is broken, you
 * can't view the incident feed to learn that. This file pings the
 * server-side `incidents/client-ingest` endpoint via sendBeacon so
 * failures show up alongside backend incidents.
 *
 * Hard rules — this file is on the boot path:
 *   - Wrapped in a try/finally so it can NEVER take the page down.
 *   - Killswitch: localStorage `incident_reporter_off=1` → no-op.
 *   - Hard-capped at MAX_PER_SESSION sends (per page load).
 *   - Per-fingerprint dedupe within DEDUPE_WINDOW_MS.
 *   - sendBeacon (text/plain → no preflight); fetch+keepalive fallback.
 *   - No PII: server scrubs, but we also length-cap every field here.
 *   - Excluded from the SW SHELL_FILES list (network-only) so a bad
 *     version of THIS file cannot get cache-pinned and brick reporting.
 */
(function () {
    'use strict';
    try {
        try { if (localStorage.getItem('incident_reporter_off') === '1') return; }
        catch (_) { /* sandboxed / private mode → safest to bail */ return; }

        var ENDPOINT = 'https://func-stockanalysis-oksq5n.azurewebsites.net/api/incidents/client-ingest';
        var MAX_PER_SESSION = 20;
        var DEDUPE_WINDOW_MS = 60 * 1000;

        var sent = 0;
        var seen = Object.create(null);

        function fingerprint(o) {
            return (o.kind || '?') + '|' + (o.function || '?') + '|' +
                   String(o.message || '').slice(0, 120);
        }

        function send(payload) {
            try {
                if (!payload || sent >= MAX_PER_SESSION) return false;

                payload.kind = String(payload.kind || 'js-error').slice(0, 40);
                payload.function = String(payload.function || 'unknown').slice(0, 80);
                payload.message = String(payload.message || '').slice(0, 500);
                payload.error_class = String(payload.error_class || payload.kind).slice(0, 80);

                var fp = fingerprint(payload);
                var now = Date.now();
                if (seen[fp] && now - seen[fp] < DEDUPE_WINDOW_MS) return false;
                seen[fp] = now;

                payload.fingerprint = fp.slice(0, 200);
                payload.ts = now;

                var body = JSON.stringify(payload);
                if (body.length > 7000) body = body.slice(0, 7000); // server caps at 8KB

                var ok = false;
                if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
                    try {
                        // Wrap in a Blob so we control the Content-Type explicitly.
                        ok = navigator.sendBeacon(
                            ENDPOINT,
                            new Blob([body], { type: 'text/plain;charset=UTF-8' })
                        );
                    } catch (_) { ok = false; }
                }
                if (!ok) {
                    try {
                        fetch(ENDPOINT, {
                            method: 'POST',
                            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                            body: body,
                            keepalive: true,
                            credentials: 'omit',
                            mode: 'cors',
                        }).catch(function () { /* swallow */ });
                    } catch (_) { /* swallow */ }
                }
                sent++;
                return true;
            } catch (_) { return false; }
        }

        window.IncidentReporter = {
            report: send,
            // Exposed for app.js so it can disable reporting without touching
            // the localStorage key (e.g. on logout if we add that later).
            disable: function () { try { localStorage.setItem('incident_reporter_off', '1'); } catch (_) {} },
            _stats: function () { return { sent: sent, capped: sent >= MAX_PER_SESSION }; },
        };

        // ── Auto-capture: uncaught errors ────────────────────────────────
        window.addEventListener('error', function (e) {
            try {
                var msg = (e && e.message) || 'error';
                var src = (e && e.filename) || '';
                var line = (e && e.lineno) || '';
                send({
                    kind: 'js-error',
                    function: 'window.onerror',
                    error_class: (e && e.error && e.error.name) || 'Error',
                    message: msg + (src ? ' @ ' + src + ':' + line : ''),
                });
            } catch (_) {}
        });

        // ── Auto-capture: unhandled promise rejections ───────────────────
        window.addEventListener('unhandledrejection', function (e) {
            try {
                var r = e && e.reason;
                var msg = (r && (r.message || (typeof r === 'string' ? r : r.toString && r.toString()))) ||
                          'unhandled rejection';
                send({
                    kind: 'unhandled-rejection',
                    function: 'window.onunhandledrejection',
                    error_class: (r && r.name) || 'UnhandledRejection',
                    message: String(msg).slice(0, 500),
                });
            } catch (_) {}
        });

        // ── SW cache-mismatch detection ──────────────────────────────────
        // If a cached version of index.html references ?v=X but the running
        // sw.js was deployed with ?v=Y, the page will load stale assets and
        // mysteriously break. The check is best-effort (compares the
        // version on this script's own <script src=…?v=X> against whatever
        // the SW reports as its CACHE_VERSION via a postMessage round-trip).
        try {
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(function (reg) {
                    if (!reg || !reg.active) return;
                    var ch = new MessageChannel();
                    ch.port1.onmessage = function (ev) {
                        try {
                            var swVer = ev && ev.data && ev.data.cacheVersion;
                            // Find this script's own ?v= as the page-version oracle.
                            var pageVer = '';
                            var scripts = document.getElementsByTagName('script');
                            for (var i = 0; i < scripts.length; i++) {
                                var m = (scripts[i].src || '').match(/incident-reporter\.js\?v=([\d.]+)/);
                                if (m) { pageVer = 'sa-v' + m[1]; break; }
                            }
                            if (swVer && pageVer && swVer !== pageVer) {
                                send({
                                    kind: 'sw-cache-mismatch',
                                    function: 'sw.cache_version',
                                    error_class: 'CacheVersionMismatch',
                                    message: 'page=' + pageVer + ' sw=' + swVer,
                                });
                            }
                        } catch (_) {}
                    };
                    try { reg.active.postMessage({ type: 'GET_VERSION' }, [ch.port2]); }
                    catch (_) {}
                }).catch(function () {});
            }
        } catch (_) {}

    } catch (_) { /* hard outer guard — never throw */ }
})();
