'use strict';

/**
 * SKILL: http
 *
 * Make HTTP requests to any API.
 * This is what connects Anubis to the Pantheon's external systems:
 *   - Stripe (war chest)
 *   - Polymarket / Kalshi (ZeusPrime)
 *   - GitHub (CI, deployments)
 *   - Nexus Relay (phone control)
 *   - Any REST API
 *
 * No external dependencies — uses Node's built-in https module.
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');
const skill_matcher = require('../skill_matcher');

const TIMEOUT_MS  = 20000;
const MAX_BODY    = 8000;

function request(method, urlStr, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return reject(new Error(`invalid URL: ${urlStr}`)); }

    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;

    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   method.toUpperCase(),
      headers:  { 'Content-Type': 'application/json', ...headers },
    };

    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { if (data.length < MAX_BODY) data += chunk; });
      res.on('end', () => {
        let parsed_body;
        try { parsed_body = JSON.parse(data); } catch { parsed_body = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed_body, raw: data });
      });
    });

    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error('request timed out')); });
    req.on('error', reject);

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const actions = {

  get: async ({ url, headers }) => {
    if (!url) return 'no URL provided';
    const res = await request('GET', url, { headers });
    return { status: res.status, body: res.body };
  },

  post: async ({ url, body, headers }) => {
    if (!url) return 'no URL provided';
    const res = await request('POST', url, { body, headers });
    return { status: res.status, body: res.body };
  },

  put: async ({ url, body, headers }) => {
    if (!url) return 'no URL provided';
    const res = await request('PUT', url, { body, headers });
    return { status: res.status, body: res.body };
  },

  delete: async ({ url, headers }) => {
    if (!url) return 'no URL provided';
    const res = await request('DELETE', url, { headers });
    return { status: res.status, body: res.body };
  },

  // ── Pre-wired Pantheon endpoints ──────────────────────────────────────

  nexus_relay_ping: async () => {
    const url    = process.env.NEXUS_RELAY_URL || 'https://nexus-relay-production.up.railway.app';
    const secret = process.env.NEXUS_SECRET    || 'pantheon_prime';
    const res    = await request('GET', `${url}/ping`, { headers: { 'X-Secret': secret } });
    return { status: res.status, body: res.body };
  },

  nexus_relay_command: async ({ command, args }) => {
    const url    = process.env.NEXUS_RELAY_URL || 'https://nexus-relay-production.up.railway.app';
    const secret = process.env.NEXUS_SECRET    || 'pantheon_prime';
    const res    = await request('POST', `${url}/command`, {
      headers: { 'X-Secret': secret },
      body:    { command, args: args || {} },
    });
    return { status: res.status, body: res.body };
  },

  stripe_balance: async () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return 'STRIPE_SECRET_KEY not set';
    const res = await request('GET', 'https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${key}` },
    });
    return { status: res.status, body: res.body };
  },

  github_ci: async ({ repo, workflow }) => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return 'GITHUB_TOKEN not set';
    const path_  = workflow
      ? `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?per_page=1`
      : `https://api.github.com/repos/${repo}/actions/runs?per_page=1`;
    const res = await request('GET', path_, {
      headers: { Authorization: `token ${token}`, 'User-Agent': 'AnubisAnkh' },
    });
    const run = res.body?.workflow_runs?.[0];
    if (!run) return 'no CI runs found';
    return { repo, status: run.conclusion || run.status, branch: run.head_branch, url: run.html_url };
  },

};

// ── Register with skill_matcher ────────────────────────────────────────────

skill_matcher.register({
  name:          'http',
  description:   'Make HTTP requests to any API',
  defaultAction: 'get',
  actions:       Object.keys(actions),
  triggers: [
    /\b(call|hit|fetch|request|ping|api|endpoint|webhook)\b/i,
    /\b(stripe|polymarket|kalshi|github|nexus relay)\b/i,
    /https?:\/\//i,
    /\b(check .*(balance|status|ci|build))\b/i,
  ],
  extract: (msg) => {
    const urlMatch = msg.match(/https?:\/\/[^\s]+/);
    return urlMatch ? { url: urlMatch[0] } : {};
  },
});

module.exports = {
  name:        'http',
  description: 'HTTP requests — connect to any API or Pantheon endpoint',
  actions,
};
