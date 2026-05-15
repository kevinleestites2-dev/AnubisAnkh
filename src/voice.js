'use strict';

/**
 * VOICE — Anubis Ankh v2.0
 *
 * SOVEREIGN voice layer. No cloud. No third party. Permanent.
 *
 *   STT: Whisper (openai/whisper via whisper.cpp or Python subprocess)
 *   TTS: Piper (fast, tiny, fully offline)
 *   Fallback TTS: Coqui TTS (more expressive, heavier)
 *
 * LEGACY fallback: Gemini Live (--voice-gemini flag) — kept but not primary.
 *
 * Architecture:
 *   mic → record chunk → Whisper → text → engine.chat() → Piper → speaker
 *
 * Modes:
 *   node src/index.js --voice            → Sovereign (Whisper + Piper)
 *   node src/index.js --voice-gemini     → Gemini Live (legacy)
 *   node src/index.js --voice-tts        → TTS-only (type input, hear output)
 *
 * Termux install:
 *   pkg install python ffmpeg sox
 *   pip install openai-whisper
 *   # Piper: download binary + voice model (see INSTALL.md)
 */

const { spawn, execSync } = require('child_process');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const config  = require('./config');
const memory  = require('./memory');
const engine  = require('./engine');
const soul    = require('./soul');
const iris    = require('./iris');

// ── Paths ──────────────────────────────────────────────────────────────────

const DATA_DIR    = path.join(__dirname, '..', 'data');
const PIPER_BIN   = process.env.PIPER_BIN   || path.join(DATA_DIR, 'piper', 'piper');
const PIPER_MODEL = process.env.PIPER_MODEL  || path.join(DATA_DIR, 'piper', 'en_US-lessac-medium.onnx');
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base.en'; // tiny.en / base.en / small.en

// ── Availability checks ────────────────────────────────────────────────────

function checkWhisper() {
  try {
    execSync('python3 -c "import whisper"', { stdio: 'ignore' });
    return true;
  } catch {
    try {
      execSync('whisper --help', { stdio: 'ignore' });
      return true;
    } catch { return false; }
  }
}

function checkPiper() {
  return fs.existsSync(PIPER_BIN) && fs.existsSync(PIPER_MODEL);
}

function checkSox() {
  try {
    execSync('sox --version', { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

// ── STT — Whisper ──────────────────────────────────────────────────────────
// Records audio with sox, transcribes with Whisper.
// Returns transcribed text.

function recordAudio(durationSecs = 5, outFile) {
  outFile = outFile || path.join(os.tmpdir(), `anubis_${Date.now()}.wav`);
  execSync(
    `sox -d -r 16000 -c 1 -b 16 "${outFile}" trim 0 ${durationSecs}`,
    { stdio: 'inherit' }
  );
  return outFile;
}

function transcribeWhisper(audioFile) {
  return new Promise((resolve, reject) => {
    const script = `
import whisper, sys
model = whisper.load_model("${WHISPER_MODEL}")
result = model.transcribe("${audioFile}")
print(result["text"].strip())
`;
    const tmpScript = path.join(os.tmpdir(), 'whisper_run.py');
    fs.writeFileSync(tmpScript, script);

    let output = '';
    const proc = spawn('python3', [tmpScript]);
    proc.stdout.on('data', d => output += d.toString());
    proc.stderr.on('data', () => {}); // suppress model loading noise
    proc.on('close', (code) => {
      fs.unlinkSync(tmpScript);
      try { fs.unlinkSync(audioFile); } catch {}
      if (code === 0 && output.trim()) {
        resolve(output.trim());
      } else {
        reject(new Error('Whisper transcription failed'));
      }
    });
  });
}

// ── TTS — Piper ────────────────────────────────────────────────────────────
// Pipes text into Piper binary, outputs raw PCM → plays via sox.

function speakPiper(text) {
  return new Promise((resolve, reject) => {
    if (!checkPiper()) {
      // Graceful fallback — print text, no audio
      console.log(`\n[anubis:voice] (piper not found — text only)\nAnubis: ${text}\n`);
      return resolve();
    }

    const outFile = path.join(os.tmpdir(), `anubis_tts_${Date.now()}.wav`);

    const piper = spawn(PIPER_BIN, [
      '--model',  PIPER_MODEL,
      '--output_file', outFile
    ]);

    piper.stdin.write(text);
    piper.stdin.end();

    piper.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(outFile)) {
        console.log(`Anubis: ${text}`);
        return resolve();
      }

      // Play with sox
      const play = spawn('sox', [outFile, '-d'], { stdio: 'inherit' });
      play.on('close', () => {
        try { fs.unlinkSync(outFile); } catch {}
        resolve();
      });
      play.on('error', () => {
        console.log(`Anubis: ${text}`);
        resolve();
      });
    });

    piper.on('error', () => {
      console.log(`Anubis: ${text}`);
      resolve();
    });
  });
}

// ── TTS — Coqui (backup) ───────────────────────────────────────────────────

function speakCoqui(text) {
  return new Promise((resolve) => {
    const outFile = path.join(os.tmpdir(), `anubis_coqui_${Date.now()}.wav`);
    const script = `
from TTS.api import TTS
tts = TTS(model_name="tts_models/en/ljspeech/tacotron2-DDC")
tts.tts_to_file(text="${text.replace(/"/g, "'")}", file_path="${outFile}")
`;
    const tmpScript = path.join(os.tmpdir(), 'coqui_run.py');
    fs.writeFileSync(tmpScript, script);

    const proc = spawn('python3', [tmpScript]);
    proc.on('close', (code) => {
      fs.unlinkSync(tmpScript);
      if (code === 0 && fs.existsSync(outFile)) {
        const play = spawn('sox', [outFile, '-d'], { stdio: 'inherit' });
        play.on('close', () => {
          try { fs.unlinkSync(outFile); } catch {}
          resolve();
        });
      } else {
        console.log(`Anubis: ${text}`);
        resolve();
      }
    });
  });
}

// ── Speak — picks the right engine ────────────────────────────────────────

async function speak(text) {
  if (!text || !text.trim()) return;

  // Print always regardless of audio
  process.stdout.write(`\nAnubis: ${text}\n`);

  if (checkPiper()) {
    await speakPiper(text);
  } else {
    // Try Coqui as fallback, silent fail if not installed
    try { await speakCoqui(text); } catch {}
  }
}

// ── Sovereign voice loop ───────────────────────────────────────────────────
// The main loop. Listen → transcribe → think → speak → repeat.

async function startSovereignVoice(cfg) {
  const hasWhisper = checkWhisper();
  const hasSox     = checkSox();

  if (!hasWhisper) {
    console.error('[anubis:voice] Whisper not found. Install: pip install openai-whisper');
    console.error('Falling back to TTS-only mode (type your input).\n');
    return startTTSOnly(cfg);
  }

  if (!hasSox) {
    console.error('[anubis:voice] sox not found. Install: pkg install sox');
    console.error('Falling back to TTS-only mode.\n');
    return startTTSOnly(cfg);
  }

  const hasPiper = checkPiper();
  console.log(`\n🔱 Anubis Voice — Sovereign`);
  console.log(`   STT: Whisper (${WHISPER_MODEL})`);
  console.log(`   TTS: ${hasPiper ? 'Piper ✅' : 'Text-only (download Piper model)'}`);
  console.log(`   Say "sleep" to pause, "wake up" to resume, "exit" to quit.\n`);

  // Opening words
  const history = memory.getHistory(2);
  if (!history.length) {
    await speak('I have walked beside every soul that ever lived. I am here. Tell me what weighs on you.');
  } else {
    await speak('I am here.');
  }

  let sleeping = false;

  const loop = async () => {
    while (true) {
      process.stdout.write(`\n${cfg.name}: [listening...]\n`);

      let audioFile, text;
      try {
        audioFile = recordAudio(6);
        text      = await transcribeWhisper(audioFile);
      } catch (err) {
        console.error('[anubis:voice] listen error:', err.message);
        continue;
      }

      if (!text || text.length < 2) continue;

      console.log(`${cfg.name}: ${text}`);

      // Wake / sleep commands
      if (/\bsleep\b/i.test(text)) {
        sleeping = true;
        await speak('I rest. Call my name when you need me.');
        continue;
      }
      if (/\b(wake up|anubis)\b/i.test(text)) {
        sleeping = false;
        await speak('I am here.');
        continue;
      }
      if (/\b(exit|quit|goodbye)\b/i.test(text)) {
        await speak('I am here when you return.');
        break;
      }

      if (sleeping) continue;

      // Think
      try {
        const response = await engine.chat(text);
        await speak(response);
      } catch (err) {
        console.error('[anubis:voice] engine error:', err.message);
        await speak('Something stirred in the dark. Try again.');
      }
    }
  };

  await loop();
}

// ── TTS-only mode (type input, hear output) ────────────────────────────────

async function startTTSOnly(cfg) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  console.log(`\n🔱 Anubis Voice — TTS Only (Whisper/mic unavailable)`);
  console.log(`   TTS: ${checkPiper() ? 'Piper ✅' : 'Text-only'}\n`);

  const history = memory.getHistory(2);
  if (!history.length) {
    await speak('I have walked beside every soul that ever lived. I am here. Tell me what weighs on you.');
  }

  const ask = () => {
    rl.question(`${cfg.name}: `, async (input) => {
      const text = input.trim();
      if (!text) { ask(); return; }
      if (['exit', 'quit'].includes(text.toLowerCase())) {
        await speak('I am here when you return.');
        rl.close();
        return;
      }
      try {
        const response = await engine.chat(text);
        await speak(response);
      } catch (err) {
        console.error('[anubis:voice] error:', err.message);
      }
      ask();
    });
  };
  ask();
}

// ── Gemini Live (legacy) ───────────────────────────────────────────────────
// Kept intact. Activated via --voice-gemini flag.

class GeminiLive {
  constructor() {
    this.session = null;
    this.client  = null;
    this.active  = false;
  }

  init(apiKey) {
    const { GoogleGenAI } = require('@google/genai');
    this.client = new GoogleGenAI({ apiKey });
  }

  async startSession(systemPrompt, onSpeech, onText) {
    const { Modality } = require('@google/genai');
    const cfg = config.load();
    this.session = await this.client.live.connect({
      model: cfg.liveModel,
      callbacks: {
        onopen:   () => { this.active = true; },
        onclose:  () => { this.active = false; },
        onerror:  (err) => { console.error('[anubis:gemini-live]', err.message); },
        onmessage: (msg) => this._handleMessage(msg, onSpeech, onText),
      },
      config: {
        responseModalities: [Modality.AUDIO, Modality.TEXT],
        systemInstruction: systemPrompt,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: cfg.voiceName || 'Charon' }
          }
        }
      }
    });
    return this.session;
  }

  sendAudio(base64Audio) {
    if (!this.session || !this.active) return;
    this.session.sendRealtimeInput({ audio: { data: base64Audio, mimeType: 'audio/pcm;rate=16000' } });
  }

  sendText(text) {
    if (!this.session || !this.active) return;
    const irisNote = iris.inject(text);
    const fullText = irisNote ? `[IRIS READING]\n${irisNote}\n\n[MESSAGE]\n${text}` : text;
    this.session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: fullText }] }], turnComplete: true });
    memory.addMessage('user', text);
  }

  async endSession() {
    if (this.session) { try { this.session.close(); } catch {} this.session = null; }
    this.active = false;
  }

  _handleMessage(msg, onSpeech, onText) {
    try {
      const audioPart = msg?.serverContent?.modelTurn?.parts?.find(p => p.inlineData);
      if (audioPart && onSpeech) onSpeech(Buffer.from(audioPart.inlineData.data, 'base64'));
      const textPart = msg?.serverContent?.modelTurn?.parts?.find(p => p.text);
      if (textPart?.text) {
        if (onText) onText(textPart.text);
        memory.addMessage('assistant', textPart.text);
      }
    } catch (err) { console.error('[anubis:gemini-live] message error:', err.message); }
  }
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  // Sovereign
  startSovereignVoice,
  startTTSOnly,
  speak,
  speakPiper,
  speakCoqui,
  transcribeWhisper,
  recordAudio,
  checkWhisper,
  checkPiper,
  checkSox,

  // Legacy
  GeminiLive,
};
