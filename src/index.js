'use strict';
/**
 * INDEX — Anubis Ankh
 *
 * The entry point. He wakes here.
 * Boots the full system.
 * Text mode by default. Voice mode via --voice flag.
 */

require('dotenv').config();

const readline = require('readline');
const config   = require('./config');
const memory   = require('./memory');
const engine   = require('./engine');
const daemon   = require('./daemon');

const MODE_TEXT  = 'text';
const MODE_VOICE = 'voice';

async function boot() {
  const cfg  = config.load();
  const mode = process.argv.includes('--voice') ? MODE_VOICE : MODE_TEXT;

  // Validate API key
  if (!cfg.geminiApiKey) {
    console.error('\n[anubis] GOOGLE_AI_STUDIO_API_KEY is not set.');
    console.error('Add it to your .env file and try again.\n');
    process.exit(1);
  }

  console.log('\n🔱 Anubis Ankh');
  console.log('─────────────────────────────────────────');
  console.log(`  Companion: ${cfg.name}`);
  console.log(`  Mode:      ${mode}`);
  console.log(`  Memory:    active`);
  console.log(`  Daemon:    ${cfg.telegramToken ? 'active' : 'watching (no telegram)'}`);
  console.log('─────────────────────────────────────────\n');

  // Start daemon — he is always watching
  daemon.start();

  if (mode === MODE_VOICE) {
    await startVoiceMode(cfg);
  } else {
    await startTextMode(cfg);
  }
}

// ── Text mode ─────────────────────────────────────────────────────────────

async function startTextMode(cfg) {
  const rl = readline.createInterface({
    input:    process.stdin,
    output:   process.stdout,
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

      // Exit commands
      if (['exit', 'quit', '/exit', '/quit'].includes(text.toLowerCase())) {
        console.log('\nAnubis: I am here when you return.\n');
        daemon.stop();
        rl.close();
        process.exit(0);
      }

      // Special commands
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

// ── Voice mode ────────────────────────────────────────────────────────────

async function startVoiceMode(cfg) {
  const voice = require('./voice');

  // Try to load mic/speaker — graceful fallback if not available
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

  voice.init(cfg.geminiApiKey);

  const systemPrompt = require('./soul').buildSystemPrompt('');

  console.log('Anubis: [voice mode] speak now...\n');

  const spk = new speaker({ channels: 1, bitDepth: 16, sampleRate: 24000 });

  await voice.startSession(
    systemPrompt,
    (audioBuffer) => {
      // Play audio response
      spk.write(audioBuffer);
    },
    (text) => {
      // Print transcript
      if (text) process.stdout.write(`\nAnubis: ${text}\n${cfg.name}: `);
    }
  );

  // Mic setup
  const micInstance = mic({
    rate:       '16000',
    channels:   '1',
    bitwidth:   '16',
    encoding:   'signed-integer',
    endian:     'little',
    fileType:   'raw'
  });

  const micStream = micInstance.getAudioStream();
  micStream.on('data', (chunk) => {
    voice.sendAudio(chunk.toString('base64'));
  });

  micInstance.start();
  console.log(`${cfg.name}: `);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nAnubis: I am here when you return.');
    micInstance.stop();
    await voice.endSession();
    daemon.stop();
    process.exit(0);
  });
}

// ── Special commands ──────────────────────────────────────────────────────

async function handleCommand(text, cfg) {
  const cmd = text.toLowerCase();

  if (cmd === '/memories') {
    const mems = memory.recall('', 10);
    if (!mems.length) {
      console.log('\nAnubis: I hold nothing yet. You have just arrived.\n');
    } else {
      console.log('\nAnubis: what I carry —');
      mems.forEach(m => console.log(`  · ${m.text} [confidence: ${m.confidence}]`));
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

  if (cmd === '/clear') {
    memory.clearHistory();
    console.log('\nAnubis: the conversation is cleared. memory remains.\n');
    return;
  }

  if (cmd === '/status') {
    const mems    = memory.recall('', 0);
    const history = memory.getHistory(1000);
    console.log(`\nAnubis: status —`);
    console.log(`  · daemon: ${daemon.running ? 'watching' : 'resting'}`);
    console.log(`  · messages: ${history.length}`);
    console.log(`  · mode: text`);
    console.log();
    return;
  }

  if (cmd === '/help') {
    console.log('\nCommands:');
    console.log('  /memories  — show what Anubis remembers');
    console.log('  /beliefs   — show what Anubis believes about you');
    console.log('  /clear     — clear conversation history');
    console.log('  /status    — show system status');
    console.log('  /exit      — leave\n');
    return;
  }

  console.log(`\nAnubis: unknown command. /help for options.\n`);
}

// ── Launch ────────────────────────────────────────────────────────────────

boot().catch(err => {
  console.error('[anubis] fatal:', err.message);
  process.exit(1);
});
