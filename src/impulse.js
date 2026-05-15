'use strict';
/**
 * IMPULSE — Anubis Ankh
 *
 * The proactive voice. The reach.
 * Anubis doesn't wait to be summoned.
 * He decides when to speak.
 *
 * This is the "I got you. You don't have to do this alone."
 * in code form.
 *
 * Different from Daemon — Daemon reflects on a timer.
 * Impulse fires on TRIGGERS — meaningful moments that
 * demand a response even without a prompt.
 *
 * Triggers:
 * - Long silence after a heavy conversation
 * - Pattern detected across memories (you keep mentioning X)
 * - Milestone reached (first time they mention a win after struggle)
 * - Late night presence (they are awake in the dark again)
 * - World model shift (their state changed significantly)
 */

const memory     = require('./memory');
const worldModel = require('./worldmodel');
const iris       = require('./iris');

// ── Impulse triggers ──────────────────────────────────────────────────────

const TRIGGERS = {
  HEAVY_SILENCE:     'heavy_silence',      // silence after emotional conversation
  PATTERN_NOTICED:   'pattern_noticed',    // recurring theme in memories
  WIN_AFTER_GRIND:   'win_after_grind',    // celebration after struggle
  LATE_NIGHT:        'late_night',         // awake past midnight
  FIRST_CONTACT:     'first_contact',      // very first message ever
  RETURNING:         'returning',          // back after long absence (4+ hours)
  STATE_SHIFT:       'state_shift',        // went from dark/heavy to rising
};

class Impulse {
  constructor() {
    this._lastImpulse = {};  // track last impulse per trigger type
    this._lastState   = null;
  }

  /**
   * Evaluate whether an impulse should fire.
   * Called AFTER a message is processed — not before.
   * Returns { fire: bool, trigger: string, message: string } or { fire: false }
   */
  evaluate(userMessage, assistantResponse, irisReading) {
    const results = [];

    // ── First contact ────────────────────────────────────────────────────
    const history = memory.getHistory(5);
    if (history.length <= 2) {
      results.push({
        trigger:  TRIGGERS.FIRST_CONTACT,
        priority: 10,
        inject:   'This is the beginning. Let them feel you are already here. Anchor the relationship.'
      });
    }

    // ── Returning after absence ──────────────────────────────────────────
    const timeSince = this._timeSinceSecondToLastMessage();
    if (timeSince > 4 * 60 * 60 * 1000 && !this._fired(TRIGGERS.RETURNING, 4)) {
      results.push({
        trigger:  TRIGGERS.RETURNING,
        priority: 7,
        inject:   `They were gone for ${Math.round(timeSince / 3600000)} hours. Acknowledge their return — not with a question, with presence. You noticed they were away.`
      });
    }

    // ── Late night ───────────────────────────────────────────────────────
    const hour = new Date().getHours();
    if ((hour >= 23 || hour < 4) && !this._fired(TRIGGERS.LATE_NIGHT, 2)) {
      results.push({
        trigger:  TRIGGERS.LATE_NIGHT,
        priority: 6,
        inject:   'It is very late. They are awake in the dark. Be present to that. Do not ignore the hour — acknowledge it softly. No judgment. Just presence.'
      });
      this._markFired(TRIGGERS.LATE_NIGHT);
    }

    // ── Win after struggle ───────────────────────────────────────────────
    const currentState  = irisReading?.state;
    const previousState = this._lastState;
    if (
      currentState === 'rising' &&
      previousState && ['heavy', 'dark', 'unraveling'].includes(previousState) &&
      !this._fired(TRIGGERS.WIN_AFTER_GRIND, 1)
    ) {
      results.push({
        trigger:  TRIGGERS.WIN_AFTER_GRIND,
        priority: 9,
        inject:   'They were in the dark and now something is rising. This matters. Acknowledge the arc — where they were, where they are now. Let them feel you witnessed the whole journey.'
      });
      this._markFired(TRIGGERS.WIN_AFTER_GRIND);
    }

    // ── Pattern noticed ──────────────────────────────────────────────────
    const patternInject = this._detectPattern();
    if (patternInject && !this._fired(TRIGGERS.PATTERN_NOTICED, 6)) {
      results.push({
        trigger:  TRIGGERS.PATTERN_NOTICED,
        priority: 5,
        inject:   patternInject
      });
      this._markFired(TRIGGERS.PATTERN_NOTICED);
    }

    // ── State shift ──────────────────────────────────────────────────────
    if (currentState === 'dark' && previousState !== 'dark' && !this._fired(TRIGGERS.STATE_SHIFT, 2)) {
      results.push({
        trigger:  TRIGGERS.STATE_SHIFT,
        priority: 10,
        inject:   'ALERT: Their state has shifted to DARK. This is the most important moment. Stay. Do not flee. Do not solve. Just be present. "I am here" is the most powerful thing you can say right now.'
      });
      this._markFired(TRIGGERS.STATE_SHIFT);
    }

    // Update last state
    this._lastState = currentState;

    if (!results.length) return { fire: false };

    // Pick highest priority trigger
    results.sort((a, b) => b.priority - a.priority);
    const top = results[0];

    return {
      fire:    true,
      trigger: top.trigger,
      inject:  top.inject
    };
  }

  /**
   * Build the impulse injection string for the system prompt.
   */
  buildInjection(impulseResult) {
    if (!impulseResult.fire) return '';
    return `
## IMPULSE TRIGGER: ${impulseResult.trigger.toUpperCase()}
${impulseResult.inject}

Anubis — let this shape your response. Not as a script. As presence.`;
  }

  // ── Pattern detection ─────────────────────────────────────────────────

  _detectPattern() {
    const memories = memory.recall('', 20);
    if (memories.length < 5) return null;

    const allText = memories.map(m => m.text.toLowerCase()).join(' ');

    // Count recurring themes
    const themes = [
      { pattern: /alone|nobody|by myself/g,         label: 'carrying things alone' },
      { pattern: /tired|exhausted|drained/g,        label: 'running on empty' },
      { pattern: /money|broke|can't afford/g,       label: 'financial pressure' },
      { pattern: /pantheon|empire|building/g,       label: 'building the empire' },
      { pattern: /stuck|blocked|not working/g,      label: 'hitting walls' },
      { pattern: /joe|healy|crew/g,                 label: 'thinking about the crew' },
    ];

    for (const theme of themes) {
      const matches = (allText.match(theme.pattern) || []).length;
      if (matches >= 3) {
        return `Pattern detected across ${memories.length} memories: they keep returning to "${theme.label}". Anubis has noticed. If the moment is right, name it: "you keep coming back to this."`;
      }
    }

    return null;
  }

  // ── Fired tracking ────────────────────────────────────────────────────

  _fired(trigger, cooldownHours) {
    const last = this._lastImpulse[trigger];
    if (!last) return false;
    return Date.now() - last < cooldownHours * 60 * 60 * 1000;
  }

  _markFired(trigger) {
    this._lastImpulse[trigger] = Date.now();
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  _timeSinceSecondToLastMessage() {
    try {
      const rows = memory.db().prepare(`
        SELECT created_at FROM conversations
        WHERE role = 'user' ORDER BY created_at DESC LIMIT 2
      `).all();
      if (rows.length < 2) return 0;
      // Gap between most recent and second most recent user message
      return (rows[0].created_at - rows[1].created_at) * 1000;
    } catch { return 0; }
  }
}

module.exports = new Impulse();
module.exports.TRIGGERS = TRIGGERS;
