'use strict';

/**
 * SKILL: web_search
 *
 * Search the web and return real data.
 * Anubis uses this for:
 *   - Real estate intel (ScoutPrime lookups)
 *   - Crypto / prediction market prices
 *   - News, current events
 *   - Any factual question that needs live data
 *
 * Primary: DuckDuckGo Instant Answer API (free, no key)
 * Extended: SearxNG (if SEARX_URL is set in .env — Vane / self-hosted)
 * Fallback: Scrape HTML from DuckDuckGo search results
 */

const https = require('https');
const { URL } = require('url');
const skill_matcher = require('../skill_matcher');

const MAX_RESULTS = 5;
const TIMEOUT_MS  = 15000;

function get(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch { return reject(new Error('invalid URL')); }

    const opts = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 AnubisAnkh/2.0',
        ...headers,
      },
    };

    const req = https.request(opts, (res) => {
      // Follow redirect
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return get(res.headers.location, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', d => { if (data.length < 20000) data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// ── DuckDuckGo Instant Answer ──────────────────────────────────────────────

async function ddgInstant(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res  = await get(url);
  const data = JSON.parse(res.body);

  const results = [];

  if (data.AbstractText) {
    results.push({ title: data.Heading, snippet: data.AbstractText, url: data.AbstractURL });
  }

  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics.slice(0, MAX_RESULTS)) {
      if (topic.Text && topic.FirstURL) {
        results.push({ title: topic.Text.split(' - ')[0], snippet: topic.Text, url: topic.FirstURL });
      }
    }
  }

  return results;
}

// ── SearxNG (self-hosted — Vane) ───────────────────────────────────────────

async function searxSearch(query, searxUrl) {
  const url = `${searxUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
  const res  = await get(url);
  const data = JSON.parse(res.body);

  return (data.results || []).slice(0, MAX_RESULTS).map(r => ({
    title:   r.title,
    snippet: r.content,
    url:     r.url,
  }));
}

// ── Format results ─────────────────────────────────────────────────────────

function formatResults(results, query) {
  if (!results.length) return `No results found for: ${query}`;
  return results.map((r, i) =>
    `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`
  ).join('\n\n');
}

const actions = {

  search: async ({ query, engine }) => {
    if (!query) return 'no query provided';

    // Try SearxNG first if configured
    const searxUrl = process.env.SEARX_URL;
    if (searxUrl && engine !== 'ddg') {
      try {
        const results = await searxSearch(query, searxUrl);
        if (results.length) return formatResults(results, query);
      } catch { /* fall through */ }
    }

    // DuckDuckGo Instant Answer
    try {
      const results = await ddgInstant(query);
      if (results.length) return formatResults(results, query);
    } catch { /* fall through */ }

    return `Could not retrieve results for: ${query}. Try again or ask differently.`;
  },

  news: async ({ topic }) => {
    if (!topic) return 'no topic provided';
    const query = `${topic} latest news ${new Date().getFullYear()}`;
    return actions.search({ query });
  },

  price: async ({ asset }) => {
    if (!asset) return 'no asset provided';
    const query = `${asset} price today USD`;
    return actions.search({ query });
  },

  real_estate: async ({ location, type }) => {
    const t     = type || 'tax deed auction';
    const query = `${location} ${t} site:lee.realtaxdeed.com OR site:redfin.com OR site:zillow.com`;
    return actions.search({ query });
  },

  polymarket: async ({ market }) => {
    const query = market
      ? `polymarket ${market} odds probability`
      : 'polymarket top markets today';
    return actions.search({ query });
  },

};

// ── Register with skill_matcher ────────────────────────────────────────────

skill_matcher.register({
  name:          'web_search',
  description:   'Search the web for live information',
  defaultAction: 'search',
  actions:       Object.keys(actions),
  triggers: [
    /\b(search|look up|find|google|what is|who is|when is|where is)\b/i,
    /\b(latest|current|today|news|price|how much)\b/i,
    /\b(polymarket|real estate|auction|foreclosure|tax deed)\b/i,
    /\?$/,
  ],
  extract: (msg) => ({ query: msg }),
});

module.exports = {
  name:        'web_search',
  description: 'Web search — live data, news, prices, real estate intel',
  actions,
};
