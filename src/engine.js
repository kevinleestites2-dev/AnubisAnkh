'use strict';
/**
 * ENGINE — Anubis Ankh
 *
 * Core chat engine. Text mode.
 * Routes messages, calls Gemini, manages history.
 * IRIS reads state before every response.
 * SOUL builds the prompt. MEMORY feeds context.
 */

const https  = require('https');
const memory = require('./memory');
const config = require('./config');
const soul   = require('./soul');
const iris   = require('./iris');

class Engine {
  async chat(userMessage) {
    const cfg = config.load();

    // Save user message
    memory.addMessage('user', userMessage);

    // Build system prompt with soul + current memories
    const systemPrompt = soul.buildSystemPrompt(userMessage);

    // IRIS reads the emotional state
    const irisInjection = iris.inject(userMessage);

    // Build full system instruction
    const fullSystem = irisInjection
      ? `${systemPrompt}\n\n${irisInjection}`
      : systemPrompt;

    // Get conversation history
    const history = memory.getHistory(20);

    // Build contents array
    const contents = history.map(h => ({
      role:  h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }));

    // The current message is already in history from addMessage above
    // but we need to re-add it at the end with iris context if any
    if (contents.length && contents[contents.length - 1].role === 'user') {
      if (irisInjection) {
        contents[contents.length - 1].parts[0].text =
          `[IRIS READING]\n${irisInjection}\n\n[MESSAGE]\n${userMessage}`;
      }
    }

    const response = await this._callGemini(cfg.geminiApiKey, cfg.model, fullSystem, contents);

    if (response) {
      memory.addMessage('assistant', response);

      // Extract memories from the response
      this._extractMemory(userMessage, response, cfg.name);
    }

    return response || "...";
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
    // If user shares something personal — store it
    const personalPatterns = [
      /i (feel|felt|am|was|need|want|miss|love|hate|remember|forgot)/i,
      /my (name|job|work|family|dog|phone|goal|dream|fear|plan)/i,
      /i'm (building|working on|trying to|afraid|tired|angry|happy)/i,
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
