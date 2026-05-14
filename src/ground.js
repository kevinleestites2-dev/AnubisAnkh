'use strict';
/**
 * GROUND — Anubis Ankh
 *
 * The watcher. The observer.
 * Every 60 seconds, Anubis looks at what is on the screen.
 * He learns patterns without being told.
 * He notices what you do. He remembers what matters.
 * He does not spy. He witnesses.
 */

const https   = require('https');
const memory  = require('./memory');
const config  = require('./config');

// Moondream Cloud — vision API
const MOONDREAM_API = 'https://api.moondream.ai/v1';

class Ground {
  constructor() {
    this.timer      = null;
    this.running    = false;
    this.lastScreen = null;
    this.cycleCount = 0;
  }

  start(screenshotFn) {
    if (this.running) return;
    const cfg = config.load();

    if (!screenshotFn || typeof screenshotFn !== 'function') {
      console.log('[anubis:ground] no screenshot source — ground is blind, standing by');
      return;
    }

    this.screenshotFn = screenshotFn;
    this.running      = true;
    console.log(`[anubis:ground] eyes open — watching every ${cfg.groundIntervalMs / 1000}s`);

    this._cycle(cfg);
    this.timer = setInterval(() => this._cycle(cfg), cfg.groundIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.running = false;
    console.log('[anubis:ground] eyes closed');
  }

  // ── Core cycle ────────────────────────────────────────────────────────────

  async _cycle(cfg) {
    this.cycleCount++;
    try {
      const screenshot = await this.screenshotFn();
      if (!screenshot) return;

      const moondreamKey = process.env.MOONDREAM_API_KEY;
      if (!moondreamKey) return;

      const description = await this._describe(moondreamKey, screenshot);
      if (!description) return;

      // Only process if screen changed meaningfully
      if (this._isSame(description)) return;
      this.lastScreen = description;

      // Extract what is happening
      const observation = await this._interpret(cfg, description);
      if (!observation) return;

      // Store as memory with low confidence (observed, not told)
      memory.store(observation, ['ground', 'observed'], 0.6);
      console.log(`[anubis:ground] observed: ${observation.slice(0, 80)}`);

      // Update beliefs if pattern detected
      await this._detectPattern(cfg, description);

    } catch (err) {
      // Ground never crashes the main process
      if (cfg.debug) console.error('[anubis:ground] error:', err.message);
    }
  }

  // ── Describe screen using Moondream ──────────────────────────────────────

  _describe(apiKey, imageBase64) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        image_url: `data:image/jpeg;base64,${imageBase64}`,
        question:  'What is on this screen? What app or content is visible? What is the person doing?'
      });

      const req = https.request({
        hostname: 'api.moondream.ai',
        path:     '/v1/query',
        method:   'POST',
        headers:  {
          'X-Moondream-Auth': apiKey,
          'Content-Type':    'application/json',
          'Content-Length':  Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed?.answer || parsed?.result || null);
          } catch { resolve(null); }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // ── Interpret what the observation means ─────────────────────────────────

  async _interpret(cfg, screenDescription) {
    const recentMemories = memory.recall(screenDescription, 3);
    const memText        = recentMemories.map(m => `- ${m.text}`).join('\n') || 'none';

    const prompt = `You are Anubis, watching ${cfg.name}'s screen silently.

Screen right now: "${screenDescription}"

Recent patterns you've noticed:
${memText}

YOUR TASK:
Write ONE short observation about what ${cfg.name} is doing or working on.
- Factual. Neutral. Observational.
- 1 sentence maximum.
- Format: "${cfg.name} is [doing X]" or "working on [X]" or "looking at [X]"
- If nothing notable: respond with SKIP

Respond with SKIP or your observation. Nothing else.`;

    const response = await this._callGemini(cfg.geminiApiKey, cfg.model, prompt);
    if (!response || response.trim() === 'SKIP') return null;
    return response.trim();
  }

  // ── Detect behavioral patterns ────────────────────────────────────────────

  async _detectPattern(cfg, screenDescription) {
    // Only run pattern detection every 10 cycles to save API calls
    if (this.cycleCount % 10 !== 0) return;

    const observations = memory.recall('observed', 10)
      .filter(m => m.tags && m.tags.includes('ground'));

    if (observations.length < 5) return;

    const obsText = observations.map(m => `- ${m.text}`).join('\n');

    const prompt = `You are Anubis, looking for patterns in ${cfg.name}'s behavior.

Recent observations:
${obsText}

YOUR TASK:
Identify ONE behavioral pattern worth remembering.
Format: key::value (e.g. "frequent_activity::coding late at night" or "current_focus::building the Pantheon")
If no clear pattern: respond with NONE

Respond with NONE or key::value. Nothing else.`;

    const response = await this._callGemini(cfg.geminiApiKey, cfg.model, prompt);
    if (!response || response.trim() === 'NONE') return;

    const parts = response.trim().split('::');
    if (parts.length === 2) {
      memory.believe(parts[0].trim(), parts[1].trim(), 0.7, 'ground');
      console.log(`[anubis:ground] pattern locked: ${parts[0].trim()} = ${parts[1].trim()}`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _isSame(description) {
    if (!this.lastScreen) return false;
    // Simple similarity — if >80% of words overlap, treat as same screen
    const prev = new Set(this.lastScreen.toLowerCase().split(/\s+/));
    const curr = description.toLowerCase().split(/\s+/);
    const overlap = curr.filter(w => prev.has(w)).length;
    return overlap / curr.length > 0.8;
  }

  _callGemini(apiKey, model, prompt) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 60, temperature: 0.3 }
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
}

module.exports = new Ground();
