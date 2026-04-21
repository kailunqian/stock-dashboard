/* API client for StockAnalysis Dashboard */

const API = {
    base: 'https://func-stockanalysis-oksq5n.azurewebsites.net',  // Azure Functions API

    // Session management
    token: localStorage.getItem('session_token') || '',

    headers() {
        const h = { 'Content-Type': 'application/json' };
        if (this.token) h['Authorization'] = `Bearer ${this.token}`;
        return h;
    },

    async fetch(path, opts = {}) {
        const resp = await fetch(`${this.base}/api/${path}`, {
            headers: this.headers(),
            ...opts,
        });
        if (resp.status === 401) {
            this.token = '';
            localStorage.removeItem('session_token');
            window.location.hash = '#/login';
            return null;
        }
        return resp.json();
    },

    // Auth
    async login(email) {
        return fetch(`${this.base}/api/dashboard/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        }).then(r => r.json());
    },

    async checkAuth() {
        try {
            const resp = await fetch(`${this.base}/api/dashboard/auth/me`, {
                headers: this.headers(),
            });
            if (resp.ok) return resp.json();
            return { authenticated: false };
        } catch { return { authenticated: false }; }
    },

    async logout() {
        await fetch(`${this.base}/api/dashboard/auth/logout`, {
            method: 'POST', headers: this.headers(),
        });
        this.token = '';
        localStorage.removeItem('session_token');
    },

    // Data endpoints
    daily()       { return this.fetch('dashboard/daily'); },
    performance() { return this.fetch('dashboard/performance'); },
    stock(sym)    { return this.fetch(`dashboard/stock/${sym}`); },
    budget()      { return this.fetch('dashboard/budget'); },
    system()      { return this.fetch('dashboard/system'); },
};
