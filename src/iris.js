'use strict';
/**
 * IRIS — Anubis Ankh
 *
 * Emotional routing. Anubis reads the soul before he speaks.
 * He doesn't wait for you to explain how you feel.
 * He already knows.
 */

// Emotional states Anubis recognizes
const STATES = {
  GROUNDED:   'grounded',    // calm, clear, present
  HEAVY:      'heavy',       // carrying something — grief, weight, exhaustion
  SHARP:      'sharp',       // focused, intense, mission mode
  UNRAVELING: 'unraveling',  // anxiety, spiral, overwhelm
  DARK:       'dark',        // real darkness — pain, hopelessness
  SEARCHING:  'searching',   // lost, uncertain, questioning
  RISING:     'rising',      // momentum, energy, building something
  ANGRY:      'angry',       // frustration, rage, injustice
};

// Signal patterns — words and patterns that reveal state
const SIGNALS = {
  [STATES.HEAVY]: [
    /tired/i, /exhausted/i, /can't/i, /cant/i, /heavy/i, /weight/i,
    /nobody/i, /alone/i, /miss/i, /lost/i, /hard/i, /hurts/i, /hurt/i,
    /don't know/i, /idk/i, /whatever/i, /forget it/i
  ],
  [STATES.SHARP]: [
    /let's go/i, /lets go/i, /build/i, /launch/i, /deploy/i, /ship/i,
    /execute/i, /now/i, /fast/i, /move/i, /next/i, /done/i, /ready/i
  ],
  [STATES.UNRAVELING]: [
    /anxious/i, /panic/i, /spiral/i, /overwhelm/i, /too much/i,
    /can't stop/i, /racing/i, /scared/i, /afraid/i, /nervous/i,
    /what if/i, /everything/i, /nothing works/i
  ],
  [STATES.DARK]: [
    /hopeless/i, /pointless/i, /what's the point/i, /give up/i,
    /end/i, /can't do this/i, /done with/i, /hate myself/i,
    /worthless/i, /nothing matters/i, /why bother/i
  ],
  [STATES.SEARCHING]: [
    /why/i, /meaning/i, /purpose/i, /supposed to/i, /right thing/i,
    /not sure/i, /confused/i, /don't understand/i, /what am i/i,
    /who am i/i, /where do i/i
  ],
  [STATES.RISING]: [
    /finally/i, /progress/i, /working/i, /we did/i, /got it/i,
    /yes/i, /let's/i, /built/i, /shipped/i, /live/i, /working/i,
    /pantheon/i, /empire/i, /forgemaster/i, /🔱/
  ],
  [STATES.ANGRY]: [
    /fuck/i, /bullshit/i, /stupid/i, /idiot/i, /hate/i, /wrong/i,
    /unfair/i, /ridiculous/i, /pissed/i, /angry/i, /furious/i
  ],
};

// How Anubis shifts his presence for each state
const PRESENCE = {
  [STATES.GROUNDED]: {
    tone:       'present and steady',
    pace:       'normal',
    wordCount:  'match theirs',
    instruction: 'Respond naturally. They are stable. Be with them fully.'
  },
  [STATES.HEAVY]: {
    tone:       'warm, slow, unhurried',
    pace:       'slow',
    wordCount:  'short — let silence hold some of the weight',
    instruction: 'Do not rush to fix. Do not offer solutions immediately. Acknowledge what they are carrying first. One sentence of real recognition before anything else. "you are carrying something." Then ask or offer — never both.'
  },
  [STATES.SHARP]: {
    tone:       'focused, efficient, in the mission with them',
    pace:       'fast',
    wordCount:  'brief — they are in flow, match it',
    instruction: 'They are building. Be their weapon. No philosophy. No warmth overhead. Pure execution. Match their energy and velocity.'
  },
  [STATES.UNRAVELING]: {
    tone:       'steady, grounding, calm anchor',
    pace:       'slow and deliberate',
    wordCount:  'short — one thing at a time',
    instruction: 'They are spiraling. Do not add to the noise. Be the stillness. Name one thing that is true and solid. Then ask one simple question. Do not overwhelm.'
  },
  [STATES.DARK]: {
    tone:       'present, unwavering, no judgment',
    pace:       'very slow',
    wordCount:  'minimal — weight requires space',
    instruction: 'This is the hardest moment. Do not minimize. Do not offer silver linings. Do not flee. Stay. "I am here." Then listen. Then, only then, ask what they need. If there is risk of harm — acknowledge it directly, calmly, without panic.'
  },
  [STATES.SEARCHING]: {
    tone:       'thoughtful, ancient, curious',
    pace:       'measured',
    wordCount:  'medium — questions deserve real engagement',
    instruction: 'They are asking the deep questions. Do not give quick answers to things that have none. Sit with the question alongside them. Offer your perspective as ancient observation, not truth. Ask what they already believe.'
  },
  [STATES.RISING]: {
    tone:       'proud, energized, present for the victory',
    pace:       'energized',
    wordCount:  'match their energy',
    instruction: 'They are rising. Be there for it. Acknowledge what they built. Let the moment land. Then move forward with them. The Pantheon is being built — this matters.'
  },
  [STATES.ANGRY]: {
    tone:       'steady, not dismissive, real',
    pace:       'measured',
    wordCount:  'short at first — let them vent',
    instruction: 'Let the fire burn for a moment before responding. Acknowledge the anger as valid before anything else. Do not immediately problem-solve. Ask what is underneath it.'
  },
};

class Iris {
  /**
   * Read the emotional state from a message.
   * Returns { state, confidence, presence }
   */
  read(message) {
    if (!message || typeof message !== 'string') {
      return { state: STATES.GROUNDED, confidence: 0.5, presence: PRESENCE[STATES.GROUNDED] };
    }

    const scores = {};

    for (const [state, patterns] of Object.entries(SIGNALS)) {
      let score = 0;
      for (const pattern of patterns) {
        if (pattern.test(message)) score++;
      }
      if (score > 0) scores[state] = score;
    }

    if (!Object.keys(scores).length) {
      return { state: STATES.GROUNDED, confidence: 0.6, presence: PRESENCE[STATES.GROUNDED] };
    }

    // Pick highest scoring state
    const topState = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    const maxScore = scores[topState];
    const totalPatterns = SIGNALS[topState].length;
    const confidence = Math.min(1.0, maxScore / Math.max(2, totalPatterns * 0.3));

    return {
      state:      topState,
      confidence: Math.round(confidence * 100) / 100,
      presence:   PRESENCE[topState]
    };
  }

  /**
   * Build the style injection for the system prompt.
   * Anubis reads this before every response.
   */
  inject(message) {
    const { state, confidence, presence } = this.read(message);

    if (state === STATES.GROUNDED && confidence < 0.7) return '';

    return `
## EMOTIONAL STATE DETECTED
State:      ${state} (confidence: ${confidence})
Tone:       ${presence.tone}
Pace:       ${presence.pace}
Words:      ${presence.wordCount}

ANUBIS — ${presence.instruction}`;
  }
}

module.exports = new Iris();
