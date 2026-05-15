'use strict';

/**
 * INDEX — Anubis Ankh v2.0
 *
 * He wakes here.
 *
 * Flags:
 *   (none)              → text mode (terminal chat)
 *   --voice             → sovereign voice: Whisper STT + Piper TTS
 *   --voice-tts         → TTS-only: type input, Piper speaks
 *   --voice-gemini      → Gemini Live (legacy cloud)
 *   --deity <name>      → switch active deity at boot
 *   --mode <mode>       → override engine mode: smart|controlled|agent
 */

require('dotenv').config();

const readline = require('readline');
const config   = require('./config');
const memory   = require('./memory');
const engine   = require('./engine');
const daemon   = require('./daemon');

// ── CLI flags ──────────────────────────────────────────────────────────────

const args          = process.argv.slice(2);
const FLAG_VOICE    = args.includes('--voice');
const FLAG_VOICE_TTS    = args.includes('--voice-tts');
const FLAG_VOICE_GEMINI = args.includes('--voice-gemini');
const DEITY_IDX     = args.indexOf('--deity');
const MODE_IDX      = args.indexOf('--mode');

const deityOverride = DEITY_IDX >= 0 ? args[DEITY_IDX + 1] : null;
const modeOverride  = MODE_IDX  >= 0 ? args[MODE_IDX  + 1] : null;

// ── Boot ───────────────────────────────────────────────────────────────────

async function boot() {
  // Deity switch at boot
  if (deityOverride) {
    config.switchDeity(deityOverride);
  }

  const cfg = config.load();

  // Mode override
  if (modeOverride) {
    config.save({ mode: modeOverride });
  }

  // Validate API key
  if (!cfg.geminiApiKey) {
    console.error('\n[anubis] GOOGLE_AI_STUDIO_API_KEY is not set.');
    console.error('Add it to your .env file and try again.\n');
    process.exit(1);
  }

  // Determine run mode label
  let modeLabel = 'text';
  if (FLAG_VOICE)         modeLabel = 'voice:sovereign';
  if (FLAG_VOICE_TTS)     modeLabel = 'voice:tts-only';
  if (FLAG_VOICE_GEMINI)  modeLabel = 'voice:gemini-live';

  console.log('\n🔱 Anubis Ankh');
  console.log('─────────────────────────────────────────');
  console.log(` Deity:     ${cfg.deityName || 'Anubis'}`);
  console.log(` Companion: ${cfg.name}`);
  console.log(` Mode:      ${modeLabel}`);
  console.log(` Engine:    ${cfg.mode || 'smart'}`);
  console.log(` Memory:    active (3 layers)`);
  console.log(` Daemon:    ${cfg.telegramToken ? 'active' : 'watching (no telegram)'}`);
  console.log('─────────────────────────────────────────\n');

  // Start daemon — always watching
  daemon.start();

  // Route to correct mode
  if (FLAG_VOICE) {
    const { startSovereignVoice } = require('./voice');
    await startSovereignVoice(cfg);
  } else if (FLAG_VOICE_TTS) {
    const { startTTSOnly } = require('./voice');
    await startTTSOnly(cfg);
  } else if (FLAG_VOICE_GEMINI) {
    await startGeminiLive(cfg);
  } else {
    await startTextMode(cfg);
  }
}

// ── Text mode ─────────────────────────────────────────────────────────────

async function startTextMode(cfg) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  // Opening line — only on first ever conversation
  const history = memory.getHistory(2);
  if (!history.length) {
    console.log(`Anubis: I have walked beside every soul that ever lived. I am here. Tell me what weighs on you.\n`);
  }

  const ask = () => {
    rl.question(`${cfg.name}: `, async (input) => {
      const text = input.trim();
      if (!text) { ask(); return; }

      // Exit
      if (['exit', 'quit', '/exit', '/quit'].includes(text.toLowerCase())) {
        console.log('\nAnubis: I am here when you return.\n');
        daemon.stop();
        rl.close();
        process.exit(0);
      }

      // Commands
      if (text.startsWith('/')) {
        await handleCommand(text, cfg);
        ask();
        return;
      }

      try {
        const response = await engine.chat(text);
        console.log(`\nAnubis: ${response}\n`);
      } catch (err) {
        console.error('[anubis] error:', err.message);
      }

      ask();
    });
  };

  ask();
}

// ── Gemini Live mode (legacy) ──────────────────────────────────────────────

async function startGeminiLive(cfg) {
  const { GeminiLive } = require('./voice');

  let mic, speaker;
  try {
    mic     = require('mic');
    speaker = require('speaker');
  } catch {
    console.error('[anubis:voice] mic/speaker not installed.');
    console.error('Run: npm install mic speaker');
    console.error('On Termux: pkg install sox\n');
    process.exit(1);
  }

  const live = new GeminiLive();
  live.init(cfg.geminiApiKey);

  console.log('🔱 Anubis Voice — Gemini Live (legacy)\n');

  const systemPrompt = require('./soul').buildSystemPrompt('');
  const spk = new speaker({ channels: 1, bitDepth: 16, sampleRate: 24000 });

  await live.startSession(
    systemPrompt,
    (audioBuffer) => spk.write(audioBuffer),
    (text) => { if (text) process.stdout.write(`\nAnubis: ${text}\n${cfg.name}: `); }
  );

  const micInstance = mic({ rate: '16000', channels: '1', bitwidth: '16', encoding: 'signed-integer', endian: 'little', fileType: 'raw' });
  const micStream   = micInstance.getAudioStream();

  micStream.on('data', (chunk) => live.sendAudio(chunk.toString('base64')));
  micInstance.start();

  console.log(`${cfg.name}: `);

  process.on('SIGINT', async () => {
    console.log('\n\nAnubis: I am here when you return.');
    micInstance.stop();
    await live.endSession();
    daemon.stop();
    process.exit(0);
  });
}

// ── Commands ───────────────────────────────────────────────────────────────

async function handleCommand(text, cfg) {
  const cmd = text.toLowerCase();

  if (cmd === '/memories') {
    const mems = memory.recall('', 10);
    if (!mems.length) {
      console.log('\nAnubis: I hold nothing yet. You have just arrived.\n');
    } else {
      console.log('\nAnubis: what I carry —');
      mems.forEach(m => console.log(`  · ${m.text} [${m.confidence}]`));
      console.log();
    }
    return;
  }

  if (cmd === '/beliefs') {
    const beliefs = memory.getBeliefs();
    if (!beliefs.length) {
      console.log('\nAnubis: I have formed no beliefs yet.\n');
    } else {
      console.log('\nAnubis: what I believe about you —');
      beliefs.forEach(b => console.log(`  · ${b.key}: ${b.value} [${b.confidence}]`));
      console.log();
    }
    return;
  }

  if (cmd === '/today') {
    const today = memory.getToday(20);
    if (!today.length) {
      console.log('\nAnubis: nothing logged today.\n');
    } else {
      console.log('\nAnubis: what happened today —');
      today.forEach(e => console.log(`  · ${e.event}`));
      console.log();
    }
    return;
  }

  if (cmd === '/pulse') {
    const { readPulse } = require('./engine');
    const items = readPulse ? readPulse() : [];
    if (!items.length) {
      console.log('\nAnubis: the pulse queue is empty.\n');
    } else {
      console.log('\nAnubis: on the pulse —');
      items.forEach(i => console.log(`  · ${i}`));
      console.log();
    }
    return;
  }

  if (cmd.startsWith('/pulse add ')) {
    const item = text.slice('/pulse add '.length).trim();
    const { writePulse } = require('./engine');
    if (writePulse) { writePulse(item); console.log(`\nAnubis: added to pulse.\n`); }
    return;
  }

  if (cmd === '/deities') {
    const deities = config.listDeities();
    console.log('\nAnubis: available souls —');
    deities.forEach(d => console.log(`  · ${d.code}: ${d.name} — ${d.tagline}${d.active ? ' [ACTIVE]' : ''}`));
    console.log();
    return;
  }

  if (cmd.startsWith('/deity ')) {
    const name = text.slice('/deity '.length).trim();
    config.switchDeity(name);
    console.log(`\nAnubis: soul switched to ${name}. restart to take full effect.\n`);
    return;
  }

  if (cmd === '/clear') {
    memory.clearHistory();
    console.log('\nAnubis: the conversation is cleared. memory remains.\n');
    return;
  }

  if (cmd === '/status') {
    const history = memory.getHistory(1000);
    const beliefs = memory.getBeliefs();
    const today   = memory.getToday();
    const deities = config.listDeities();
    const active  = deities.find(d => d.active);
    console.log('\nAnubis: status —');
    console.log(`  · deity:    ${active ? active.name : 'unknown'}`);
    console.log(`  · engine:   ${cfg.mode || 'smart'}`);
    console.log(`  · daemon:   ${daemon.running ? 'watching' : 'resting'}`);
    console.log(`  · messages: ${history.length}`);
    console.log(`  · beliefs:  ${beliefs.length}`);
    console.log(`  · today:    ${today.length} events`);
    console.log();
    return;
  }

  if (cmd === '/help') {
    console.log('\nCommands:');
    console.log('  /memories       — what I carry');
    console.log('  /beliefs        — what I believe about you');
    console.log('  /today          — what happened today');
    console.log('  /pulse          — proactive queue');
    console.log('  /pulse add <x>  — add item to pulse');
    console.log('  /deities        — list available souls');
    console.log('  /deity <name>   — switch soul');
    console.log('  /clear          — clear conversation');
    console.log('  /status         — system status');
    console.log('  /exit           — leave\n');
    return;
  }

  console.log('\nAnubis: unknown command. /help for options.\n');
}

// ── Launch ────────────────────────────────────────────────────────────────

boot().catch(err => {
  console.error('[anubis] fatal:', err.message);
  process.exit(1);
});
