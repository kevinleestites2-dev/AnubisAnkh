'use strict';

/**
 * SKILL: telegram
 *
 * Send messages and alerts via the Pantheon's Telegram bot.
 * Used by:
 *   - daemon.js — proactive alerts while Anubis runs in background
 *   - ZeusPrime alerts — trade signals, balance changes
 *   - MidasPrime — war chest milestones
 *   - Any Pantheon system that needs to reach the Forgemaster
 *
 * Uses the same Telegram bot already configured in ZeusPrime.
 * Token + Chat ID pulled from .env.
 */

const https = require('https');
const skill_matcher = require('../skill_matcher');

const TELEGRAM_API = 'api.telegram.org';
const MAX_MSG      = 4096; // Telegram limit

function sendRaw(token, chatId, text, opts = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id:    chatId,
      text:       text.slice(0, MAX_MSG),
      parse_mode: opts.parseMode || 'Markdown',
      disable_web_page_preview: true,
      ...opts,
    });

    const reqOpts = {
      hostname: TELEGRAM_API,
      path:     `/bot${token}/sendMessage`,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ ok: false, raw: data }); }
      });
    });

    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const actions = {

  send: async ({ message, token, chatId, parseMode }) => {
    const tok  = token  || process.env.TELEGRAM_BOT_TOKEN;
    const chat = chatId || process.env.TELEGRAM_CHAT_ID;
    if (!tok)  return 'TELEGRAM_BOT_TOKEN not set';
    if (!chat) return 'TELEGRAM_CHAT_ID not set';
    if (!message) return 'no message provided';

    const res = await sendRaw(tok, chat, message, { parseMode });
    return res.ok ? 'sent' : `telegram error: ${JSON.stringify(res)}`;
  },

  alert: async ({ subject, body, icon }) => {
    const tok  = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_CHAT_ID;
    if (!tok || !chat) return 'telegram not configured';

    const emoji = icon || '🔱';
    const text  = `${emoji} *${subject}*\n\n${body}`;
    const res   = await sendRaw(tok, chat, text);
    return res.ok ? 'alert sent' : `error: ${JSON.stringify(res)}`;
  },

  war_chest_update: async ({ amount, source, balance }) => {
    const tok  = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_CHAT_ID;
    if (!tok || !chat) return 'telegram not configured';

    const text = [
      `💰 *War Chest Update*`,
      ``,
      `+$${amount} — ${source}`,
      `Balance: $${balance}`,
      ``,
      `MidasPrime is accumulating. 🔱`,
    ].join('\n');

    const res = await sendRaw(tok, chat, text);
    return res.ok ? 'war chest update sent' : `error: ${JSON.stringify(res)}`;
  },

  zeus_alert: async ({ market, action, amount, confidence }) => {
    const tok  = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_CHAT_ID;
    if (!tok || !chat) return 'telegram not configured';

    const text = [
      `⚡ *ZeusPrime Signal*`,
      ``,
      `Market: ${market}`,
      `Action: ${action}`,
      `Amount: $${amount}`,
      `Confidence: ${confidence}%`,
    ].join('\n');

    const res = await sendRaw(tok, chat, text);
    return res.ok ? 'zeus alert sent' : `error: ${JSON.stringify(res)}`;
  },

  get_updates: async ({ token, chatId, offset }) => {
    const tok = token || process.env.TELEGRAM_BOT_TOKEN;
    if (!tok) return 'TELEGRAM_BOT_TOKEN not set';

    return new Promise((resolve) => {
      const params = `?offset=${offset || 0}&limit=10&timeout=0`;
      const reqOpts = {
        hostname: TELEGRAM_API,
        path:     `/bot${tok}/getUpdates${params}`,
        method:   'GET',
      };
      const req = https.request(reqOpts, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const msgs   = (parsed.result || []).map(u => ({
              id:   u.update_id,
              text: u.message?.text,
              from: u.message?.from?.username,
              date: u.message?.date,
            }));
            resolve(msgs);
          } catch { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      req.end();
    });
  },

};

// ── Register with skill_matcher ────────────────────────────────────────────

skill_matcher.register({
  name:          'telegram',
  description:   'Send alerts and messages via Telegram',
  defaultAction: 'send',
  actions:       Object.keys(actions),
  triggers: [
    /\b(telegram|send .*(alert|message|notification))\b/i,
    /\b(notify|alert).*(forgemaster|me|telegram)\b/i,
    /\b(war chest update|zeus alert|midas alert)\b/i,
  ],
  extract: (msg) => ({ message: msg }),
});

module.exports = {
  name:        'telegram',
  description: 'Telegram — Pantheon alert system',
  actions,
};
