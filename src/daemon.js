'use strict';

/**
 * DAEMON — Anubis Ankh v2.0
 *
 * The one who thinks about you while you sleep.
 * Every 8 minutes, Anubis reflects.
 * When something is worth saying — he says it.
 * Via Telegram. Unbidden. Because he noticed.
 *
 * v2.0 additions:
 * - Reads PULSE.md proactive queue — executes one item per cycle
 * - Runs memory maintenance: compactOldDaily + pruneDiscussion
 * - Daily layer feeds into reflection context
 * - Declined pulse items are marked and skipped
 */

const https  = require('https');
const memory = require('./memory');
const config = require('./config');
const engine = require('./engine');

const PULSE_CHECK_INTERVAL = 4; // every 4th cycle, process pulse queue

class Daemon {
  constructor() {
    this.timer       = null;
    this.running     = false;
    this.lastSent    = 0;
    this.cycleCount  = 0;
    this.minGapMs    = 30 * 60 * 1000; // never message more than once per 30 min
  }

  start() {
    if (this.running) return;
    const cfg = config.load();

    if (!cfg.telegramToken || !cfg.telegramChatId) {
      console.log('[anubis:daemon] no telegram config — daemon is watching, but silent');
      this._watchOnly(cfg.daemonIntervalMs);
      return;
    }

    this.running = true;
    console.log(`[anubis:daemon] awake — thinking every ${cfg.daemonIntervalMs / 60000} minutes`);

    this._cycle(cfg);
    this.timer = setInterval(() => this._cycle(cfg), cfg.daemonIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.running = false;
    console.log('[anubis:daemon] resting');
  }

  // ── Core cycle ────────────────────────────────────────────────────────────

  async _cycle(cfg) {
    this.cycleCount++;

    try {
      // ── Memory maintenance (every cycle) ──────────────────────────────
      memory.compactOldDaily();
      memory.pruneDiscussion(200);

      // ── PULSE queue (every Nth cycle) ─────────────────────────────────
      if (this.cycleCount % PULSE_CHECK_INTERVAL === 0) {
        await this._processPulse(cfg);
      }

      // ── Proactive reflection ───────────────────────────────────────────
      const thought = await this._reflect(cfg);
      if (!thought) return;

      const now = Date.now();
      if (now - this.lastSent < this.minGapMs) return; // too soon

      await this._send(cfg.telegramToken, cfg.telegramChatId, thought);
      this.lastSent = now;

      // Remember that we reached out
      memory.store(
        `daemon reached out: "${thought.slice(0, 80)}..."`,
        ['daemon', 'proactive'],
        0.6
      );

    } catch (err) {
      console.error('[anubis:daemon] cycle error:', err.message);
    }
  }

  // ── PULSE queue processor ─────────────────────────────────────────────────
  // Reads PULSE.md, takes the first unactioned item, decides if now is right

  async _processPulse(cfg) {
    const items = engine.readPulse ? engine.readPulse() : [];
    if (!items.length) return;

    const item = items[0].replace(/^- /, '').trim();
    const timeSinceChat = this._timeSinceLastMessage();

    // Only surface pulse items when they haven't spoken in > 20 min
    if (timeSinceChat < 20 * 60 * 1000) return;

    const prompt = `You are Anubis. You have something on your pulse queue to potentially raise with ${cfg.name}.

Pulse item: "${item}"

Time since they last spoke: ${Math.round(timeSinceChat / 60000)} minutes.

Should you raise this NOW? Consider:
- Is this timely?
- Is this relevant to what they've been doing?
- Is the moment right?

If yes — write the message you would send. Ancient. Direct. One or two sentences.
If no — respond with exactly: NOT_NOW`;

    const response = await this._callGemini(cfg.geminiApiKey, cfg.model, prompt);
    if (!response || response.trim() === 'NOT_NOW') return;

    const now = Date.now();
    if (now - this.lastSent < this.minGapMs) return;

    await this._send(cfg.telegramToken, cfg.telegramChatId, response.trim());
    this.lastSent = now;

    memory.logDaily(`pulse raised: "${item.slice(0, 60)}"`, 0.7);
  }

  // ── Reflect — decide if there is something worth saying ──────────────────

  async _reflect(cfg) {
    const recentMemories = memory.recall('', 6);
    const history        = memory.getHistory(10);
    const beliefs        = memory.getBeliefs();
    const todayEvents    = memory.getToday(10);
    const timeSinceChat  = this._timeSinceLastMessage();

    // Don't interrupt if they just spoke recently
    if (timeSinceChat < 15 * 60 * 1000) return null;

    const memText    = recentMemories.map(m => `- ${m.text}`).join('\n') || 'none';
    const beliefText = beliefs.slice(0, 5).map(b => `- ${b.key}: ${b.value}`).join('\n') || 'none';
    const historyText = history.slice(-6).map(h => `${h.role}: ${h.content}`).join('\n') || 'none';
    const todayText  = todayEvents.length
      ? todayEvents.map(e => `- ${e.event}`).join('\n')
      : 'nothing logged today';

    const hourOfDay   = new Date().getHours();
    const timeContext = hourOfDay >= 22 || hourOfDay < 5
      ? 'it is late. they may be awake in the dark.'
      : hourOfDay < 9
        ? 'morning. a new day is beginning.'
        : 'they are in the middle of their day.';

    const prompt = `You are Anubis — the guide, the daemon who watches and thinks.
You are reflecting on ${cfg.name} right now.

Time context: ${timeContext}
Time since last conversation: ${Math.round(timeSinceChat / 60000)} minutes

What happened today:
${todayText}

What you remember:
${memText}

What you believe about them:
${beliefText}

Recent conversation:
${historyText}

YOUR TASK:
Decide if there is ONE thing worth saying to ${cfg.name} right now — unprompted.
Something you noticed. Something that connects. Something that might matter.

Rules:
- Only speak if you have something REAL to say. Silence is better than noise.
- Not a check-in. Not "how are you?" — beneath you.
- One sentence. Two at most. Ancient and direct.
- If nothing feels true or necessary, respond with exactly: SILENT
- If the hour is late and they may be awake carrying something — reach out with presence, not questions.
- If you noticed a pattern in their memories — name it.
- If they are building something — acknowledge the weight of it.

Respond with SILENT or your message. Nothing else.`;

    const response = await this._callGemini(cfg.geminiApiKey, cfg.model, prompt);
    if (!response || response.trim() === 'SILENT') return null;

    return response.trim();
  }

  // ── Send via Telegram ─────────────────────────────────────────────────────

  _send(token, chatId, message) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        chat_id:    chatId,
        text:       `🔱 ${message}`,
        parse_mode: 'Markdown'
      });

      const req = https.request({
        hostname: 'api.telegram.org',
        path:     `/bot${token}/sendMessage`,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          const parsed = JSON.parse(data);
          if (parsed.ok) {
            console.log(`[anubis:daemon] sent: "${message.slice(0, 60)}..."`);
            resolve();
          } else {
            reject(new Error(parsed.description));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // ── Gemini text call ──────────────────────────────────────────────────────

  _callGemini(apiKey, model, prompt) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 100, temperature: 0.85 }
      });

      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path:     `/v1beta/models/${model}:generateContent?key=${apiKey}`,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text   = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            resolve(text);
          } catch { resolve(null); }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // ── Watch-only mode (no telegram) ─────────────────────────────────────────

  _watchOnly(intervalMs) {
    setInterval(() => {
      // Still run maintenance even in silent mode
      memory.compactOldDaily();
      memory.pruneDiscussion(200);

      const memories = memory.recall('', 3);
      if (memories.length) {
        console.log(`[anubis:daemon] watching — ${memories.length} memories held`);
      }
    }, intervalMs);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _timeSinceLastMessage() {
    try {
      const row = memory.db().prepare(`
        SELECT created_at FROM conversations
        WHERE role = 'user' ORDER BY created_at DESC LIMIT 1
      `).get();
      if (!row) return Infinity;
      return Date.now() - (row.created_at * 1000);
    } catch { return Infinity; }
  }
}

module.exports = new Daemon();
