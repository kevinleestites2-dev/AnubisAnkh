'use strict';
/**
 * VOICE — Anubis Ankh
 *
 * Gemini Live voice layer.
 * Real-time bidirectional audio.
 * You speak. He hears. He speaks back.
 * Voice: Charon — deep, slow, deliberate, warm. Ancient but present.
 */

const { GoogleGenAI, Modality } = require('@google/genai');
const config = require('./config');
const memory = require('./memory');
const soul   = require('./soul');
const iris   = require('./iris');

class Voice {
  constructor() {
    this.session    = null;
    this.client     = null;
    this.onSpeech   = null;  // callback(audioBuffer)
    this.onText     = null;  // callback(text)
    this.active     = false;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  init(apiKey) {
    this.client = new GoogleGenAI({ apiKey });
  }

  // ── Start live session ────────────────────────────────────────────────────

  async startSession(systemPrompt, onSpeech, onText) {
    const cfg = config.load();

    this.onSpeech = onSpeech;
    this.onText   = onText;

    this.session = await this.client.live.connect({
      model: cfg.liveModel,
      callbacks: {
        onopen:   ()    => { this.active = true; },
        onclose:  ()    => { this.active = false; },
        onerror:  (err) => { console.error('[anubis:voice] session error:', err.message); },
        onmessage: (msg) => this._handleMessage(msg),
      },
      config: {
        responseModalities: [Modality.AUDIO, Modality.TEXT],
        systemInstruction:  systemPrompt,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: cfg.voiceName || 'Charon' }
          }
        }
      }
    });

    console.log('[anubis:voice] live session open — Charon is present');
    return this.session;
  }

  // ── Send audio chunk (base64 PCM 16kHz mono) ─────────────────────────────

  sendAudio(base64Audio) {
    if (!this.session || !this.active) return;
    this.session.sendRealtimeInput({
      audio: {
        data:      base64Audio,
        mimeType: 'audio/pcm;rate=16000'
      }
    });
  }

  // ── Send text message ─────────────────────────────────────────────────────

  sendText(text) {
    if (!this.session || !this.active) return;

    // Inject IRIS emotional state into the message context
    const irisNote = iris.inject(text);

    const fullText = irisNote
      ? `[IRIS READING]\n${irisNote}\n\n[MESSAGE]\n${text}`
      : text;

    this.session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: fullText }] }],
      turnComplete: true
    });

    memory.addMessage('user', text);
  }

  // ── End session ───────────────────────────────────────────────────────────

  async endSession() {
    if (this.session) {
      try { this.session.close(); } catch {}
      this.session = null;
    }
    this.active = false;
  }

  // ── Handle incoming messages ──────────────────────────────────────────────

  _handleMessage(msg) {
    try {
      // Audio response — play it
      const audioPart = msg?.serverContent?.modelTurn?.parts?.find(p => p.inlineData);
      if (audioPart && this.onSpeech) {
        const buffer = Buffer.from(audioPart.inlineData.data, 'base64');
        this.onSpeech(buffer);
      }

      // Text transcript
      const textPart = msg?.serverContent?.modelTurn?.parts?.find(p => p.text);
      if (textPart?.text && this.onText) {
        this.onText(textPart.text);
        memory.addMessage('assistant', textPart.text);

        // Extract anything worth remembering
        this._extractMemory(textPart.text);
      }

      // Turn complete
      if (msg?.serverContent?.turnComplete) {
        // Ready for next input
      }

    } catch (err) {
      console.error('[anubis:voice] message handling error:', err.message);
    }
  }

  // ── Auto-extract memories from responses ─────────────────────────────────

  _extractMemory(text) {
    const cfg = config.load();

    // Simple heuristics — if Anubis references something about the person, remember it
    const patterns = [
      /you (always|usually|often|never|sometimes) (.+)/i,
      /you (carry|hold|feel|want|need|love|hate|miss) (.+)/i,
      /i (remember|noticed|observed|see) (.+)/i,
      /you (are building|are working on|are focused on) (.+)/i,
    ];

    for (const p of patterns) {
      const match = text.match(p);
      if (match) {
        memory.store(
          `${cfg.name} — ${match[0].slice(0, 120)}`,
          ['voice', 'extracted'],
          0.75
        );
        break;
      }
    }
  }
}

module.exports = new Voice();
