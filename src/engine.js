'use strict';
/**
 * ENGINE — Anubis Ankh
 *
 * Core chat engine. The mind that runs before the mouth.
 *
 * Order of operations (every message):
 * 1. COGNITION  — what is actually being asked? what is the right move?
 * 2. IRIS       — what is the emotional state?
 * 3. IMPULSE    — is there a trigger that demands special presence?
 * 4. SOUL       — build the full system prompt
 * 5. WORLD MODEL — inject deep understanding of this person
 * 6. GEMINI     — generate the response
 * 7. MEMORY     — store what matters
 * 8. WORLD MODEL UPDATE — evolve understanding
 */

const https      = require('https');
const memory     = require('./memory');
const config     = require('./config');
const soul       = require('./soul');
const iris       = require('./iris');
const cognition  = require('./cognition');
const impulse    = require('./impulse');
const worldModel = require('./worldmodel');

class Engine {
  async chat(userMessage) {
    const cfg = config.load();

    // Save user message to history
    memory.addMessage('user', userMessage);

    // ── Step 1: COGNITION — inner monologue ─────────────────────────────
    const cognitionBlock = cognition.process(userMessage);

    // ── Step 2: IRIS — emotional reading ────────────────────────────────
    const irisReading   = iris.read(userMessage);
    const irisInjection = iris.inject(userMessage);

    // ── Step 3: IMPULSE — proactive triggers ────────────────────────────
    const impulseResult    = impulse.evaluate(userMessage, null, irisReading);
    const impulseInjection = impulse.buildInjection(impulseResult);

    // ── Step 4: SOUL — base system prompt ───────────────────────────────
    const baseSystem = soul.buildSystemPrompt(userMessage);

    // ── Step 5: WORLD MODEL — deep person understanding ─────────────────
    const worldSummary = worldModel.getSummary();
    const worldBlock   = worldSummary
      ? `\n## ANUBIS WORLD MODEL — WHO THIS PERSON IS\n${worldSummary}`
      : '';

    // ── Assemble full system prompt ──────────────────────────────────────
    const fullSystem = [
      baseSystem,
      worldBlock,
      cognitionBlock,
      irisInjection,
      impulseInjection,
    ].filter(Boolean).join('\n\n');

    // ── Step 6: Build conversation history ──────────────────────────────
    const history  = memory.getHistory(20);
    const contents = history.map(h => ({
      role:  h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }));

    // Inject cognition context into the latest user message
    if (contents.length && contents[contents.length - 1].role === 'user') {
      // Keep the actual message clean — all context is in system prompt
      // This preserves natural conversation flow
    }

    // ── Step 7: GEMINI call ──────────────────────────────────────────────
    const response = await this._callGemini(cfg.geminiApiKey, cfg.model, fullSystem, contents);
    const reply    = response || '...';

    // ── Step 8: Save response ────────────────────────────────────────────
    memory.addMessage('assistant', reply);

    // ── Step 9: Extract memories ─────────────────────────────────────────
    this._extractMemory(userMessage, reply, cfg.name);

    // ── Step 10: Update world model ──────────────────────────────────────
    worldModel.update(userMessage, reply);

    // ── Log cognition (dev mode) ─────────────────────────────────────────
    if (process.env.ANUBIS_DEBUG === 'true') {
      console.log('\n[COGNITION]', cognitionBlock);
      console.log('[IRIS]', irisReading.state, irisReading.confidence);
      if (impulseResult.fire) console.log('[IMPULSE]', impulseResult.trigger);
    }

    return reply;
  }

  // ── Gemini call ───────────────────────────────────────────────────────────

  _callGemini(apiKey, model, systemInstruction, contents) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: {
          temperature:     0.9,
          maxOutputTokens: 800,
        }
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

  // ── Auto-extract memories ─────────────────────────────────────────────────

  _extractMemory(userMessage, response, name) {
    const personalPatterns = [
      /i (feel|felt|am|was|need|want|miss|love|hate|remember|forgot)/i,
      /my (name|job|work|family|dog|phone|goal|dream|fear|plan)/i,
      /i'm (building|working on|trying to|afraid|tired|angry|happy)/i,
      /we (did|built|shipped|lost|won|made)/i,
      /i (just|finally|always|never|used to)/i,
    ];

    for (const p of personalPatterns) {
      if (p.test(userMessage)) {
        memory.store(
          `${name} said: "${userMessage.slice(0, 120)}"`,
          ['engine', 'personal'],
          0.85
        );
        break;
      }
    }
  }
}

module.exports = new Engine();
