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
        const resp = await fetch(`${this.base}/api/auth/signup`, {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || 'Failed to send sign-in link');
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
        try {
            const resp = await fetch(`${this.base}/api/dashboard/auth/me`, {
                credentials: 'include',
                headers: this.headers(),
            });
            const result = resp.ok ? await resp.json() : { authenticated: false };
            this._authCache = { result, expires: now + this.AUTH_TTL_MS };
            return result;
        } catch {
            return { authenticated: false };
        }
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
};
