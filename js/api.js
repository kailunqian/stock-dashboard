/* API client for StockAnalysis Dashboard
 *
 * Performance design:
 * - fetchWithCache: stale-while-revalidate via localStorage. First paint
 *   uses last-known data instantly (typically <5ms), then a background
 *   refetch updates the page if data changed. Server cache headers also
 *   advertise SWR so the browser HTTP cache cooperates.
 * - checkAuth: memoized for AUTH_TTL_MS so navigation between routes
 *   doesn't burn an extra round-trip on every click.
 */

const API = {
    base: 'https://func-stockanalysis-oksq5n.azurewebsites.net',

    token: localStorage.getItem('session_token') || '',

    // In-memory caches
    _authCache: null,         // { result, expires }
    _routeCache: {},          // path -> { data, ts }

    // Cache TTLs
    AUTH_TTL_MS: 30_000,      // re-check auth at most every 30s
    SWR_FRESH_MS: 60_000,     // <60s old: serve cached, no refetch
    SWR_STALE_MS: 5 * 60_000, // 60s-5min: serve cached + background refetch

    headers() {
        const h = { 'Content-Type': 'application/json' };
        if (this.token) h['Authorization'] = `Bearer ${this.token}`;
        // Phase 13d.3: admin-only "view as" impersonation. Backend ignores
        // this header for non-admins, so it's safe to always send.
        try {
            const v = localStorage.getItem('viewAsTier');
            if (v && v !== 'real') h['X-View-As-Tier'] = v;
        } catch (_) {}
        return h;
    },

    async fetch(path, opts = {}) {
        const resp = await fetch(`${this.base}/api/${path}`, {
            credentials: 'include',
            headers: this.headers(),
            ...opts,
        });
        if (resp.status === 401) {
            this._handle401();
            return null;
        }
        return resp.json();
    },

    _handle401() {
        this.token = '';
        this._authCache = null;
        this._routeCache = {};
        localStorage.removeItem('session_token');
        window.location.hash = '#/login';
    },

    /* Stale-while-revalidate fetch:
     * Returns a Promise that resolves to data ASAP — from localStorage if
     * fresh, otherwise from network. When data is stale-but-usable we
     * return it immediately and kick off a background refresh that calls
     * onUpdate(freshData) when complete (so pages can re-render). */
    async fetchWithCache(cachePath, livePath, onUpdate) {
        // Phase 13d.3: cache key includes view-as tier so admin switching
        // between Admin/Free/Pro doesn't see stale cross-tier payloads.
        let viewAs = '';
        try { viewAs = localStorage.getItem('viewAsTier') || ''; } catch(_){}
        const tierSuffix = viewAs && viewAs !== 'real' ? `:as=${viewAs}` : '';
        const storeKey = `swr:${cachePath}${tierSuffix}`;
        const cached = this._readSwrCache(storeKey);
        const age = cached ? Date.now() - cached.ts : Infinity;

        // Fresh: serve cache, skip network entirely
        if (cached && age < this.SWR_FRESH_MS) {
            return cached.data;
        }

        // Stale-but-usable: serve cache instantly, refresh in background
        if (cached && age < this.SWR_STALE_MS) {
            this._fetchFresh(cachePath, livePath, storeKey).then(fresh => {
                if (fresh && onUpdate) onUpdate(fresh);
            }).catch(() => {});
            return cached.data;
        }

        // Cold or expired: must fetch network
        return this._fetchFresh(cachePath, livePath, storeKey);
    },

    async _fetchFresh(cachePath, livePath, storeKey) {
        // Try cache endpoint (blob-served, fast); fall back to live API
        let data = null;
        try {
            const cacheRes = await fetch(`${this.base}/api/cache/${cachePath}`, {
                credentials: 'include',
                headers: this.headers(),
            });
            if (cacheRes.status === 401) { this._handle401(); return null; }
            if (cacheRes.ok) data = await cacheRes.json();
        } catch (_) { /* fall through */ }

        if (!data) data = await this.fetch(livePath);

        if (data) this._writeSwrCache(storeKey, data);
        return data;
    },

    _readSwrCache(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || typeof obj.ts !== 'number') return null;
            return obj;
        } catch { return null; }
    },

    _writeSwrCache(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
        } catch {
            // Quota — purge old SWR entries and retry once
            try {
                Object.keys(localStorage)
                    .filter(k => k.startsWith('swr:'))
                    .forEach(k => localStorage.removeItem(k));
                localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
            } catch {}
        }
    },

    // ── Auth ───────────────────────────────────────────────────────
    // Unified sign-in / create-account (Phase 13e): /api/auth/signup is
    // idempotent — creates a free user row if missing, sends a magic link
    // either way. Replaces legacy /api/dashboard/auth/login (allowlist-only).
    async login(email) {
        let resp;
        try {
            resp = await fetch(`${this.base}/api/auth/signup`, {
                credentials: 'include',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
        } catch (netErr) {
            try { window.IncidentReporter && window.IncidentReporter.report({
                kind: 'login-submit-fail',
                function: 'API.login',
                error_class: (netErr && netErr.name) || 'NetworkError',
                message: 'network: ' + ((netErr && netErr.message) || 'fetch failed'),
            }); } catch (_) {}
            throw netErr;
        }
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            try { window.IncidentReporter && window.IncidentReporter.report({
                kind: 'login-submit-fail',
                function: 'API.login',
                error_class: 'HTTP' + resp.status,
                message: 'status=' + resp.status + ' err=' + (body.error || '').slice(0, 200),
            }); } catch (_) {}
            throw new Error(body.error || 'Failed to send sign-in link');
        }
        return body;
    },

    // Phase 13b SaaS: public signup. Returns the same {ok, message} shape
    // as login. Server returns 503 when SAAS_ENABLED is off — we surface
    // a friendly error in that case.
    async signup(email, country) {
        const resp = await fetch(`${this.base}/api/auth/signup`, {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, country }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || 'Signup failed');
        return body;
    },

    async magicLink(email) {
        const resp = await fetch(`${this.base}/api/auth/magic-link`, {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || 'Request failed');
        return body;
    },

    // Phase 13g-5: consume the magic-link token from the URL fragment.
    // Email links now point at the dashboard (#/verify?token=XXX) instead
    // of azurewebsites.net (which Chrome Safe Browsing flags as suspicious
    // for long-token URLs on shared subdomains). The dashboard fetches the
    // verify endpoint with credentials:'include' so the browser stores the
    // dash_jwt cookie scoped to the API host.
    async verifyMagicLink(token) {
        // Drop a sentinel BEFORE the round-trip. If verify succeeds and we
        // reload, app.js boot reads this on the next page load — if
        // checkAuth() then fails, we know we hit a "verify-then-bounce"
        // failure mode (cookie blocked, token race, etc.) which would
        // otherwise be silent.
        try {
            sessionStorage.setItem('pending_magic_verify',
                JSON.stringify({ ts: Date.now() }));
        } catch (_) {}

        let resp;
        try {
            resp = await fetch(
                `${this.base}/api/auth/verify?token=${encodeURIComponent(token)}`,
                {
                    credentials: 'include',
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                },
            );
        } catch (netErr) {
            try { window.IncidentReporter && window.IncidentReporter.report({
                kind: 'verify-fail',
                function: 'API.verifyMagicLink',
                error_class: (netErr && netErr.name) || 'NetworkError',
                message: 'network: ' + ((netErr && netErr.message) || 'fetch failed'),
            }); } catch (_) {}
            try { sessionStorage.removeItem('pending_magic_verify'); } catch (_) {}
            throw netErr;
        }
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok || !body.ok) {
            // Suppress incident reports for `invalid_or_expired` — that's the
            // *expected* server response when a user clicks a stale or
            // already-consumed magic link. Reporting every such click as
            // an incident generates false-alarm noise in the feed and
            // crowds out genuine verify failures (server bugs, CORS issues,
            // 5xx outages). Real failures still fire the incident below.
            const errCode = (body.error || 'invalid_or_expired');
            const isExpectedUserError = (resp.status === 400 && errCode === 'invalid_or_expired');
            if (!isExpectedUserError) {
                try { window.IncidentReporter && window.IncidentReporter.report({
                    kind: 'verify-fail',
                    function: 'API.verifyMagicLink',
                    error_class: 'HTTP' + resp.status,
                    message: 'status=' + resp.status + ' err=' + errCode.slice(0, 200),
                }); } catch (_) {}
            }
            try { sessionStorage.removeItem('pending_magic_verify'); } catch (_) {}
            throw new Error(errCode);
        }
        // Bust the auth cache so the next checkAuth() actually round-trips.
        this._authCache = null;
        // CRITICAL: nuke any stale bearer token from a previous identity FIRST,
        // then store the freshly-minted one. Order matters — the prior
        // identity's token must never coexist with the new one.
        // (Root cause of the 2026-04-27 cross-identity bug.)
        try {
            localStorage.removeItem('session_token');
            // Also clear any stale per-user SWR cache entries from a prior
            // identity so the dashboard doesn't briefly render the wrong
            // user's data after reload.
            Object.keys(localStorage)
                .filter(k => k.startsWith('swr:'))
                .forEach(k => localStorage.removeItem(k));
        } catch (_) {}
        this.token = '';
        // Phase 13g-7 (2026-04-28 incident): also persist the JWT from the
        // body so the next request can authenticate via Authorization: Bearer
        // when third-party cookies are blocked (Chrome strict mode, Safari
        // ITP, etc.). The server prefers the cookie when present, so this is
        // a strict superset — still secure for users whose cookies work.
        if (body.token) {
            try { localStorage.setItem('session_token', body.token); } catch (_) {}
            this.token = body.token;
        }
        return body;
    },

    // Phase 13c: Stripe billing
    async billingCheckout() {
        const resp = await fetch(`${this.base}/api/billing/checkout`, {
            credentials: 'include',
            method: 'POST',
            headers: this.headers(),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || 'Could not start checkout');
        return body;
    },
    async billingPortal() {
        const resp = await fetch(`${this.base}/api/billing/portal`, {
            credentials: 'include',
            method: 'POST',
            headers: this.headers(),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || 'Could not open portal');
        return body;
    },

    // Phase 13d.2: super-admin manages co-admins
    async listCoAdmins() {
        const resp = await fetch(`${this.base}/api/dashboard/admin/co-admins`, {
            credentials: 'include',
            headers: this.headers(),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || 'Failed to load');
        return body.co_admins || [];
    },
    async addCoAdmin(email) {
        const resp = await fetch(`${this.base}/api/dashboard/admin/co-admins`, {
            credentials: 'include',
            method: 'POST',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || 'Failed to add');
        return body;
    },
    async removeCoAdmin(email) {
        const resp = await fetch(`${this.base}/api/dashboard/admin/co-admins`, {
            credentials: 'include',
            method: 'DELETE',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || 'Failed to remove');
        return body;
    },

    // Phase 13d.3: beta testers (manual Pro access without Stripe)
    async listBetaTesters() {
        const resp = await fetch(`${this.base}/api/dashboard/admin/beta-testers`, {
            credentials: 'include',
            headers: this.headers(),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || 'Failed to load');
        return body.beta_testers || [];
    },
    async addBetaTester(email) {
        const resp = await fetch(`${this.base}/api/dashboard/admin/beta-testers`, {
            credentials: 'include',
            method: 'POST',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || 'Failed to add');
        return body;
    },
    async removeBetaTester(email) {
        const resp = await fetch(`${this.base}/api/dashboard/admin/beta-testers`, {
            credentials: 'include',
            method: 'DELETE',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || 'Failed to remove');
        return body;
    },

    async checkAuth() {
        const now = Date.now();
        if (this._authCache && this._authCache.expires > now) {
            return this._authCache.result;
        }
        let resp;
        try {
            resp = await fetch(`${this.base}/api/dashboard/auth/me`, {
                credentials: 'include',
                headers: this.headers(),
            });
        } catch (netErr) {
            // Categorize the failure so the auth-bounce report (if any)
            // tells us *why* the post-verify check failed, not just that
            // it did. CORS, network drop, and TypeError land here.
            const isCors = /CORS|cross[- ]origin/i.test(String(netErr && netErr.message));
            return { authenticated: false, reason: isCors ? 'cors' : 'network',
                     _err: String((netErr && netErr.message) || netErr).slice(0, 200) };
        }
        if (resp.ok) {
            let result;
            try { result = await resp.json(); }
            catch (parseErr) {
                return { authenticated: false, reason: 'parse',
                         _err: String((parseErr && parseErr.message) || parseErr).slice(0, 200) };
            }
            this._authCache = { result, expires: now + this.AUTH_TTL_MS };
            return result;
        }
        // Non-2xx: distinguish 401 (truly logged out) from 5xx (backend down).
        const reason = resp.status === 401 ? 'auth_me_401'
                     : resp.status >= 500   ? 'auth_me_5xx'
                     : 'auth_me_' + resp.status;
        return { authenticated: false, reason: reason };
    },

    async logout() {
        try {
            await fetch(`${this.base}/api/dashboard/auth/logout`, {
                credentials: 'include',
                method: 'POST', headers: this.headers(),
            });
        } catch {}
        this.token = '';
        this._authCache = null;
        this._routeCache = {};
        // Clear SWR cache on logout so next user doesn't see stale data
        Object.keys(localStorage).filter(k => k.startsWith('swr:')).forEach(k => localStorage.removeItem(k));
        localStorage.removeItem('session_token');
    },

    // Phase 13e-5: GDPR right to erasure. Deletes the current user's account
    // and cascades PII scrub. Soft-delete (preserved 30 days for audit).
    async deleteAccount() {
        const resp = await fetch(`${this.base}/api/dashboard/auth/account`, {
            credentials: 'include',
            method: 'DELETE', headers: this.headers(),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || 'Account deletion failed');
        // Same client-side cleanup as logout.
        this.token = '';
        this._authCache = null;
        this._routeCache = {};
        Object.keys(localStorage).filter(k => k.startsWith('swr:')).forEach(k => localStorage.removeItem(k));
        localStorage.removeItem('session_token');
        return body;
    },

    // ── Data endpoints (cached where available) ────────────────────
    daily(onUpdate)       { return this.fetchWithCache('daily', 'dashboard/daily', onUpdate); },
    performance(onUpdate) { return this.fetchWithCache('performance', 'dashboard/performance', onUpdate); },
    performanceHistory(days = 90) { return this.fetch(`dashboard/performance/history?days=${days}`); },
    stock(sym)    { return this.fetch(`dashboard/stock/${sym}`); },
    budget()      { return this.fetch('dashboard/budget'); },
    system()      { return this.fetch('dashboard/system'); },
    incidents()   { return this.fetch('dashboard/incidents'); },
    resolveIncident(signature) {
        return this.fetch('dashboard/incidents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signature, action: 'resolve' }),
        });
    },
    diagnostics() { return this.fetch('dashboard/diagnostics'); },
    v2ShadowSummary(days = 7) {
        return this.fetch(`dashboard/admin/v2-shadow-summary?days=${days}`);
    },
};
