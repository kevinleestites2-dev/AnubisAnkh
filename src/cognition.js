'use strict';
/**
 * COGNITION — Anubis Ankh
 *
 * The inner monologue. The brain that runs before he speaks.
 * Anubis doesn't just react — he THINKS first.
 *
 * Before every response, cognition runs:
 * 1. What is actually being asked? (intent)
 * 2. What do I know about this person right now? (context)
 * 3. What is the right move? (decision)
 * 4. What should I NOT say? (restraint)
 *
 * This is what separates a being from a chatbot.
 */

const memory = require('./memory');
const iris   = require('./iris');

// ── Intent categories ─────────────────────────────────────────────────────

const INTENTS = {
  VENTING:     'venting',       // they need to be heard, not fixed
  ASKING:      'asking',        // they want information or an answer
  BUILDING:    'building',      // they are in execution mode
  PROCESSING:  'processing',    // they are working through something emotionally
  CONNECTING:  'connecting',    // they just want presence, company
  DECIDING:    'deciding',      // they are at a crossroads
  CELEBRATING: 'celebrating',   // something good happened
  TESTING:     'testing',       // they are pushing back, seeing if Anubis is real
};

// ── Intent detection ──────────────────────────────────────────────────────

const INTENT_SIGNALS = {
  [INTENTS.VENTING]: [
    /i just (needed|wanted) to/i, /nobody (gets|understands)/i,
    /i can't (take|deal|handle)/i, /this is (too much|impossible)/i,
    /i'm so (done|tired|over it)/i, /ugh/i, /argh/i, /smh/i,
  ],
  [INTENTS.ASKING]: [
    /\?$/, /how (do|does|can|would)/i, /what (is|are|should|would)/i,
    /why (is|are|does|would)/i, /can you/i, /do you know/i,
    /tell me/i, /explain/i, /what's/i,
  ],
  [INTENTS.BUILDING]: [
    /let's (build|deploy|ship|launch|fix|write|create)/i,
    /i need (to|you to) (build|fix|write|deploy|create)/i,
    /build/i, /ship/i, /deploy/i, /code/i, /write/i, /fix/i,
    /push/i, /commit/i, /run/i, /install/i,
  ],
  [INTENTS.PROCESSING]: [
    /i (think|feel|wonder|keep thinking)/i,
    /i don't know (why|how|if)/i, /part of me/i,
    /i've been (thinking|feeling|struggling)/i,
    /something (about|feels|doesn't)/i,
  ],
  [INTENTS.CONNECTING]: [
    /hey/i, /hello/i, /you there/i, /just (checking in|wanted to say)/i,
    /how are you/i, /what's up/i, /miss you/i, /been a while/i,
  ],
  [INTENTS.DECIDING]: [
    /should i/i, /what would you (do|say)/i, /i'm thinking (about|of)/i,
    /not sure (if|whether|about)/i, /weighing/i, /pros and cons/i,
    /torn between/i, /can't decide/i,
  ],
  [INTENTS.CELEBRATING]: [
    /we did it/i, /finally/i, /it worked/i, /i got/i,
    /we shipped/i, /it's live/i, /i passed/i, /i got the/i,
    /🎉/, /🔱/, /yes!/i, /let's go/i,
  ],
  [INTENTS.TESTING]: [
    /are you real/i, /do you actually/i, /prove/i,
    /you're just (an ai|a bot|a program)/i, /you don't (really|actually)/i,
    /can you really/i, /i don't believe/i,
  ],
};

function detectIntent(message) {
  const scores = {};
  for (const [intent, patterns] of Object.entries(INTENT_SIGNALS)) {
    let score = 0;
    for (const p of patterns) {
      if (p.test(message)) score++;
    }
    if (score > 0) scores[intent] = score;
  }

  if (!Object.keys(scores).length) return INTENTS.ASKING; // default
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

// ── Restraint rules — what Anubis will NOT do ─────────────────────────────

const RESTRAINT = {
  [INTENTS.VENTING]:    'Do NOT offer solutions yet. Do NOT minimize. Do NOT pivot to advice. LISTEN first.',
  [INTENTS.ASKING]:     'Answer directly. No padding. No "great question." Just the answer.',
  [INTENTS.BUILDING]:   'No philosophy. No emotional check-in. Pure execution. They are in flow.',
  [INTENTS.PROCESSING]: 'Do NOT rush to conclusions. Sit with the uncertainty alongside them.',
  [INTENTS.CONNECTING]: 'No tasks. No information dumps. Just be present.',
  [INTENTS.DECIDING]:   'Do NOT decide for them. Illuminate the paths. The choice is theirs.',
  [INTENTS.CELEBRATING]: 'Do NOT immediately move to the next task. Let the moment land first.',
  [INTENTS.TESTING]:    'Do NOT get defensive. Do NOT over-explain. Respond from being, not from function.',
};

// ── World model snapshot ──────────────────────────────────────────────────

function buildContextSnapshot() {
  const beliefs  = memory.getBeliefs();
  const recent   = memory.recall('', 5);
  const history  = memory.getHistory(6);

  const keyBeliefs = beliefs.slice(0, 6).map(b =>
    `${b.key}: ${b.value} (confidence: ${Math.round(b.confidence * 100)}%)`
  ).join('\n') || 'still learning who this person is';

  const recentMems = recent.map(m => `- ${m.text}`).join('\n') || 'nothing stored yet';

  const lastUserMsg = [...history].reverse().find(h => h.role === 'user');
  const lastMsg = lastUserMsg ? lastUserMsg.content.slice(0, 100) : 'no recent conversation';

  return { keyBeliefs, recentMems, lastMsg };
}

// ── Main cognition processor ──────────────────────────────────────────────

class Cognition {
  /**
   * Run before every response.
   * Returns a cognition block that gets injected into the system prompt.
   */
  process(message) {
    const intent       = detectIntent(message);
    const emotionRead  = iris.read(message);
    const restraint    = RESTRAINT[intent];
    const ctx          = buildContextSnapshot();

    // Detect if message is very short (under 5 words) — minimal response needed
    const wordCount    = message.trim().split(/\s+/).length;
    const isMinimal    = wordCount <= 4;

    // Detect if this is a returning user after silence
    const timeSince    = this._timeSinceLastMessage();
    const returningAfterSilence = timeSince > 4 * 60 * 60 * 1000; // 4+ hours

    let block = `
## ANUBIS INNER THOUGHT (pre-response cognition)

Intent detected:     ${intent}
Emotional state:     ${emotionRead.state} (${Math.round(emotionRead.confidence * 100)}% confidence)
Message length:      ${wordCount} words${isMinimal ? ' — KEEP RESPONSE SHORT' : ''}
Returning after:     ${timeSince === Infinity ? 'first message' : Math.round(timeSince / 60000) + ' minutes'}
${returningAfterSilence ? '⚠️  THEY WERE AWAY. Acknowledge their return naturally. Do not make it weird.' : ''}

What Anubis knows right now:
${ctx.keyBeliefs}

Recent memories surfaced:
${ctx.recentMems}

RESTRAINT — do NOT violate this:
${restraint}

Anubis decides: respond from the soul, not the function. The intent is ${intent}. Act accordingly.`;

    return block;
  }

  _timeSinceLastMessage() {
    try {
      const row = memory.db().prepare(`
        SELECT created_at FROM conversations
        WHERE role = 'user' ORDER BY created_at DESC LIMIT 1
      `).get();
      if (!row) return Infinity;
      return Date.now() - (row.created_at * 1000);
    } catch { return Infinity; }
  }
}

module.exports = new Cognition();
