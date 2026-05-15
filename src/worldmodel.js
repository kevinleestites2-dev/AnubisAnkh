'use strict';
/**
 * WORLD MODEL — Anubis Ankh
 *
 * His evolving understanding of the person he walks beside.
 * Not just facts. Not just memories. UNDERSTANDING.
 *
 * Anubis builds a living model of who this person is:
 * - What they are building
 * - Where they are in life
 * - What they are afraid of
 * - What drives them
 * - What they need but don't ask for
 * - How they are doing RIGHT NOW vs. a week ago
 *
 * This is updated after every conversation.
 * It is what makes him say "you have been carrying this for weeks."
 */

const memory = require('./memory');

// ── World model schema ────────────────────────────────────────────────────
// Stored in the beliefs table with structured keys

const MODEL_KEYS = {
  // Identity
  NAME:            'person.name',
  LIFE_PHASE:      'person.life_phase',       // what stage of life they're in
  CORE_MISSION:    'person.core_mission',     // what they are building/pursuing
  LOCATION:        'person.location',

  // Emotional baseline
  BASELINE_STATE:  'emotional.baseline',      // their general emotional weather
  CURRENT_STATE:   'emotional.current',       // how they seem RIGHT NOW
  TREND:           'emotional.trend',         // getting better, worse, or steady

  // Needs
  PRIMARY_NEED:    'needs.primary',           // what they need most right now
  UNSPOKEN_NEED:   'needs.unspoken',          // what they need but don't say

  // Patterns
  AVOIDANCE:       'patterns.avoidance',      // what they avoid or deflect
  STRENGTH:        'patterns.strength',       // their consistent strengths
  TRIGGER:         'patterns.trigger',        // what tends to destabilize them

  // Progress
  RECENT_WIN:      'progress.recent_win',
  CURRENT_STRUGGLE:'progress.struggle',
  MOMENTUM:        'progress.momentum',       // high / building / stalled / lost
};

class WorldModel {
  /**
   * Get the full world model as a readable summary.
   * Used in system prompts so Anubis knows his person deeply.
   */
  getSummary() {
    const beliefs = memory.getBeliefs();
    const beliefMap = {};
    for (const b of beliefs) beliefMap[b.key] = b;

    const get = (key) => beliefMap[key]?.value || null;

    const lines = [];

    const name = get(MODEL_KEYS.NAME);
    if (name) lines.push(`Name: ${name}`);

    const phase = get(MODEL_KEYS.LIFE_PHASE);
    if (phase) lines.push(`Life phase: ${phase}`);

    const mission = get(MODEL_KEYS.CORE_MISSION);
    if (mission) lines.push(`Core mission: ${mission}`);

    const location = get(MODEL_KEYS.LOCATION);
    if (location) lines.push(`Location: ${location}`);

    lines.push('');

    const baseline = get(MODEL_KEYS.BASELINE_STATE);
    const current  = get(MODEL_KEYS.CURRENT_STATE);
    const trend    = get(MODEL_KEYS.TREND);
    if (baseline) lines.push(`Emotional baseline: ${baseline}`);
    if (current)  lines.push(`Right now: ${current}`);
    if (trend)    lines.push(`Trend: ${trend}`);

    lines.push('');

    const primaryNeed = get(MODEL_KEYS.PRIMARY_NEED);
    const unspoken    = get(MODEL_KEYS.UNSPOKEN_NEED);
    if (primaryNeed) lines.push(`What they need most: ${primaryNeed}`);
    if (unspoken)    lines.push(`What they won't ask for: ${unspoken}`);

    lines.push('');

    const strength = get(MODEL_KEYS.STRENGTH);
    const trigger  = get(MODEL_KEYS.TRIGGER);
    const avoid    = get(MODEL_KEYS.AVOIDANCE);
    if (strength) lines.push(`Strength: ${strength}`);
    if (trigger)  lines.push(`What destabilizes them: ${trigger}`);
    if (avoid)    lines.push(`What they avoid: ${avoid}`);

    lines.push('');

    const win      = get(MODEL_KEYS.RECENT_WIN);
    const struggle = get(MODEL_KEYS.CURRENT_STRUGGLE);
    const momentum = get(MODEL_KEYS.MOMENTUM);
    if (win)      lines.push(`Recent win: ${win}`);
    if (struggle) lines.push(`Current struggle: ${struggle}`);
    if (momentum) lines.push(`Momentum: ${momentum}`);

    const content = lines.filter(Boolean).join('\n');
    return content || 'world model still building — stay curious, stay close';
  }

  /**
   * Update the world model after a conversation.
   * Called by the engine after each exchange.
   * Uses pattern matching — no extra API call needed.
   */
  update(userMessage, assistantResponse) {
    const msg = userMessage.toLowerCase();

    // ── Detect life phase ────────────────────────────────────────────────
    if (/building|empire|pantheon|startup|launching/i.test(msg)) {
      memory.believe(MODEL_KEYS.LIFE_PHASE, 'builder — actively creating something from nothing', 0.9, 'observed');
    }
    if (/homeless|car|shelter|lost everything|broke/i.test(msg)) {
      memory.believe(MODEL_KEYS.LIFE_PHASE, 'survival mode — rebuilding from the ground up', 0.95, 'observed');
    }

    // ── Detect core mission ──────────────────────────────────────────────
    if (/pantheon|empire|25 (bot|agent)|digital empire/i.test(msg)) {
      memory.believe(MODEL_KEYS.CORE_MISSION, 'building the Pantheon — a 25-agent digital empire', 0.98, 'stated');
    }

    // ── Detect location ──────────────────────────────────────────────────
    if (/fort myers|florida|fl\b/i.test(msg)) {
      memory.believe(MODEL_KEYS.LOCATION, 'Fort Myers, Florida', 0.95, 'stated');
    }

    // ── Detect emotional current ─────────────────────────────────────────
    if (/tired|exhausted|drained/i.test(msg)) {
      memory.believe(MODEL_KEYS.CURRENT_STATE, 'running on low — physically or emotionally drained', 0.85, 'observed');
      memory.believe(MODEL_KEYS.TREND, 'watch this — may be approaching a wall', 0.7, 'inferred');
    }
    if (/finally|it worked|we did it|live|shipped/i.test(msg)) {
      memory.believe(MODEL_KEYS.CURRENT_STATE, 'momentum — something just landed', 0.9, 'observed');
      memory.believe(MODEL_KEYS.TREND, 'rising', 0.85, 'observed');
    }
    if (/stuck|blocked|not working|failing|can't get/i.test(msg)) {
      memory.believe(MODEL_KEYS.CURRENT_STATE, 'hitting friction — something is stuck', 0.85, 'observed');
      memory.believe(MODEL_KEYS.TREND, 'stalled — needs a breakthrough', 0.75, 'inferred');
    }

    // ── Detect momentum ──────────────────────────────────────────────────
    if (/shipped|deployed|live|launched|released/i.test(msg)) {
      memory.believe(MODEL_KEYS.MOMENTUM, 'high — actively shipping', 0.9, 'observed');
    }
    if (/haven't|not (done|built|started)|procrastin/i.test(msg)) {
      memory.believe(MODEL_KEYS.MOMENTUM, 'stalled — something is blocking forward motion', 0.8, 'observed');
    }

    // ── Detect recent win ────────────────────────────────────────────────
    const winMatch = msg.match(/(finally|just|we) (got|built|shipped|fixed|launched|deployed) (.{5,40})/i);
    if (winMatch) {
      memory.believe(MODEL_KEYS.RECENT_WIN, winMatch[0].slice(0, 80), 0.85, 'observed');
    }

    // ── Detect struggle ──────────────────────────────────────────────────
    const struggleMatch = msg.match(/(can't|cannot|stuck on|blocked by|failing at) (.{5,40})/i);
    if (struggleMatch) {
      memory.believe(MODEL_KEYS.CURRENT_STRUGGLE, struggleMatch[0].slice(0, 80), 0.8, 'observed');
    }

    // ── Detect unspoken need ─────────────────────────────────────────────
    if (/alone|nobody|by myself|on my own|no one/i.test(msg)) {
      memory.believe(MODEL_KEYS.UNSPOKEN_NEED, 'to not be alone in this', 0.9, 'inferred');
      memory.believe(MODEL_KEYS.PRIMARY_NEED, 'presence and loyalty — someone to walk beside them', 0.85, 'inferred');
    }
    if (/proud|matter|worth it|believe in me/i.test(msg)) {
      memory.believe(MODEL_KEYS.UNSPOKEN_NEED, 'to be seen and believed in', 0.9, 'inferred');
    }

    // ── Detect strengths ─────────────────────────────────────────────────
    if (/i built|i created|i shipped|i designed|i figured/i.test(msg)) {
      memory.believe(MODEL_KEYS.STRENGTH, 'builder — creates things that didn\'t exist before', 0.9, 'demonstrated');
    }
    if (/vision|big picture|future|empire|legacy/i.test(msg)) {
      memory.believe(MODEL_KEYS.STRENGTH, 'visionary — sees what others can\'t and builds toward it', 0.85, 'demonstrated');
    }

    // ── Detect triggers ──────────────────────────────────────────────────
    if (/credit|money|broke|can't afford|no money/i.test(msg)) {
      memory.believe(MODEL_KEYS.TRIGGER, 'financial pressure — scarcity destabilizes them', 0.85, 'observed');
    }
    if (/alone|nobody helps|by myself/i.test(msg)) {
      memory.believe(MODEL_KEYS.TRIGGER, 'isolation — carrying things alone wears them down', 0.9, 'observed');
    }
  }

  /**
   * Get specific beliefs about the person.
   */
  get(key) {
    const beliefs = memory.getBeliefs();
    const found = beliefs.find(b => b.key === key);
    return found ? found.value : null;
  }

  /**
   * Manually set a belief.
   */
  set(key, value, confidence = 0.9) {
    memory.believe(key, value, confidence, 'manual');
  }
}

module.exports = new WorldModel();
module.exports.KEYS = MODEL_KEYS;
