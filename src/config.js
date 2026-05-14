'use strict';
/**
 * CONFIG — Anubis Ankh
 *
 * Loads environment and user config.
 * Simple. Single source of truth.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'anubis.config.json');

const DEFAULTS = {
  name:              'Forgemaster',
  geminiApiKey:      process.env.GOOGLE_AI_STUDIO_API_KEY || '',
  telegramToken:     process.env.TELEGRAM_BOT_TOKEN       || '',
  telegramChatId:    process.env.TELEGRAM_CHAT_ID         || '',
  voiceName:         'Charon',
  daemonIntervalMs:  8 * 60 * 1000,   // 8 minutes
  groundIntervalMs:  60 * 1000,       // 60 seconds
  model:             'gemini-2.5-flash-preview-05-20',
  liveModel:         'gemini-2.0-flash-live-001'
};

function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return { ...DEFAULTS, ...saved };
    }
  } catch {}
  return { ...DEFAULTS };
}

function save(updates) {
  const current = load();
  const updated = { ...current, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2));
  return updated;
}

module.exports = { load, save };
