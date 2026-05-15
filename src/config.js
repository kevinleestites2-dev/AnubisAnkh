'use strict';

/**
 * CONFIG — Anubis Ankh v2.0
 *
 * Single source of truth.
 * Loads deity.config.json first — active deity sets the soul.
 * Then overlays anubis.config.json (user overrides) + .env.
 *
 * To switch deities: change deity.config.json "deity" field.
 * Everything else — voice, soul, db path, personality — follows automatically.
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const ROOT         = path.join(__dirname, '..');
const DEITY_FILE   = path.join(ROOT, 'deity.config.json');
const RUNTIME_FILE = path.join(ROOT, 'anubis.config.json');

// ── Base defaults (non-deity) ─────────────────────────────────────────────

const BASE_DEFAULTS = {
  name:             'Forgemaster',
  geminiApiKey:     process.env.GOOGLE_AI_STUDIO_API_KEY  || '',
  telegramToken:    process.env.TELEGRAM_BOT_TOKEN        || '',
  telegramChatId:   process.env.TELEGRAM_CHAT_ID          || '',
  daemonIntervalMs: 8 * 60 * 1000,   // 8 minutes
  groundIntervalMs: 60 * 1000,        // 60 seconds
  model:            'gemini-2.5-flash-preview-05-20',
  liveModel:        'gemini-2.0-flash-live-001',
  mode:             'smart',          // smart | controlled | agent
};

// ── Load deity config ─────────────────────────────────────────────────────

function loadDeity() {
  try {
    if (!fs.existsSync(DEITY_FILE)) return {};
    const raw     = JSON.parse(fs.readFileSync(DEITY_FILE, 'utf8'));
    const active  = raw.deity || 'anubis';
    const deities = raw.deities || {};
    const deity   = deities[active] || {};

    return {
      deityName:    deity.name        || active,
      deityCode:    active,
      voiceName:    deity.voice       || 'Charon',
      personality:  deity.personality || {},
      soulFile:     deity.soulFile    ? path.join(ROOT, deity.soulFile)    : null,
      ownerFile:    deity.ownerFile   ? path.join(ROOT, deity.ownerFile)   : null,
      pulseFile:    deity.pulseFile   ? path.join(ROOT, deity.pulseFile)   : null,
      dbFile:       deity.dbFile      ? path.join(ROOT, deity.dbFile)      : path.join(ROOT, 'data', `${active}.db`),
      tagline:      deity.tagline     || '',
      signature:    deity.personality?.signature || '',
    };
  } catch (err) {
    console.warn('[config] deity.config.json load error:', err.message);
    return {};
  }
}

// ── Load runtime overrides ────────────────────────────────────────────────

function loadRuntime() {
  try {
    if (!fs.existsSync(RUNTIME_FILE)) return {};
    return JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
  } catch { return {}; }
}

// ── Master load ───────────────────────────────────────────────────────────

function load() {
  const deity   = loadDeity();
  const runtime = loadRuntime();

  // Priority: runtime overrides > deity config > base defaults
  return {
    ...BASE_DEFAULTS,
    ...deity,
    ...runtime,
  };
}

// ── Save runtime override ─────────────────────────────────────────────────
// Only saves non-deity fields. Deity is always set via deity.config.json.

function save(updates) {
  const current = loadRuntime();
  const updated = { ...current, ...updates };
  fs.writeFileSync(RUNTIME_FILE, JSON.stringify(updated, null, 2));
  return load(); // return full merged config
}

// ── Switch deity ──────────────────────────────────────────────────────────

function switchDeity(deityCode) {
  try {
    const raw = JSON.parse(fs.readFileSync(DEITY_FILE, 'utf8'));
    if (!raw.deities[deityCode]) {
      throw new Error(`unknown deity: ${deityCode}. available: ${Object.keys(raw.deities).join(', ')}`);
    }
    raw.deity = deityCode;
    fs.writeFileSync(DEITY_FILE, JSON.stringify(raw, null, 2));
    console.log(`[config] deity switched to: ${deityCode}`);
    return load();
  } catch (err) {
    console.error('[config] switchDeity error:', err.message);
    return load();
  }
}

// ── List available deities ────────────────────────────────────────────────

function listDeities() {
  try {
    const raw = JSON.parse(fs.readFileSync(DEITY_FILE, 'utf8'));
    return Object.entries(raw.deities).map(([code, d]) => ({
      code,
      name:    d.name,
      tagline: d.tagline,
      active:  code === raw.deity,
    }));
  } catch { return []; }
}

module.exports = { load, save, switchDeity, listDeities };
