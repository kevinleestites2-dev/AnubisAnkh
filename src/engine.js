'use strict';

/**
 * ENGINE — Anubis Ankh v2.0
 *
 * The ReAct core. Plan → Execute → Recover → Answer.
 * Three modes: smart / controlled / agent.
 * Human-in-the-loop pause/resume.
 * Skills → Actions → Tools → Functions chain.
 *
 * Order of operations (every message):
 *  1. MODE — detect execution mode
 *  2. COGNITION — what is actually being asked? what is the right move?
 *  3. IRIS — what is the emotional state?
 *  4. IMPULSE — is there a trigger that demands special presence?
 *  5. SOUL — build the full system prompt
 *  6. WORLD MODEL — inject deep understanding of this person
 *  7. REACT LOOP — plan, execute tools, recover from failures, answer
 *  8. MEMORY — store what matters
 *  9. WORLD MODEL UPDATE — evolve understanding
 */

const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const memory   = require('./memory');
const config   = require('./config');
const soul     = require('./soul');
const iris     = require('./iris');
const cognition = require('./cognition');
const impulse  = require('./impulse');
const worldModel = require('./worldmodel');

// ── Execution modes ───────────────────────────────────────────────────────

const MODES = {
  SMART:      'smart',      // Anubis chooses the best mode for each task
  CONTROLLED: 'controlled', // Predictable, skills-only, no dynamic planning
  AGENT:      'agent',      // Full ReAct loop — plans, executes tools, recovers
};

const MODE_SIGNALS = {
  [MODES.AGENT]: [
    /\b(build|deploy|run|execute|launch|install|create|write|push|commit|ship)\b/i,
    /\b(search|find|look up|check|fetch|get me|pull)\b/i,
    /\b(step by step|walk me through|do this for me)\b/i,
    /\b(autonomously|automatically|on your own)\b/i,
  ],
  [MODES.CONTROLLED]: [
    /\b(remind me|set a timer|schedule|alarm|note)\b/i,
    /\b(what time|what day|what's the date)\b/i,
    /\b(convert|calculate|math|currency)\b/i,
  ],
};

function detectMode(message, cfg) {
  // Explicit override in config
  if (cfg.mode && cfg.mode !== MODES.SMART) return cfg.mode;

  // Signal-based detection
  for (const [mode, patterns] of Object.entries(MODE_SIGNALS)) {
    for (const p of patterns) {
      if (p.test(message)) return mode;
    }
  }

  return MODES.SMART;
}

// ── Skills registry ───────────────────────────────────────────────────────
// Skills → Actions → Tools → Functions
// Add new skills here. Each skill exposes actions.
// Actions call tools. Tools call functions.

const SKILLS = {
  system: {
    description: 'System information and context',
    actions: {
      getTime: {
        description: 'Get current date and time',
        fn: () => ({ result: new Date().toLocaleString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long',
          day: 'numeric', hour: '2-digit', minute: '2-digit'
        })})
      },
      getUptime: {
        description: 'How long the system has been running',
        fn: () => ({ result: `uptime: ${Math.round(process.uptime())}s` })
      },
    }
  },
  memory: {
    description: 'Store and recall memories',
    actions: {
      recall: {
        description: 'Search memories for a topic',
        fn: ({ query }) => {
          const mems = memory.recall(query, 5);
          return { result: mems.length
            ? mems.map(m => `- ${m.text}`).join('\n')
            : 'no memories found for that topic' };
        }
      },
      store: {
        description: 'Store a new memory',
        fn: ({ text, tags }) => {
          memory.store(text, tags || ['manual'], 1.0);
          return { result: 'memory stored' };
        }
      },
    }
  },
  // Future skills plug in here:
  // weather: { ... }
  // files: { ... }
  // phone: { ... }   ← NexusClaw bridge
  // web: { ... }     ← search + fetch
};

// ── Tool execution ─────────────────────────────────────────────────────────

function executeTool(skillName, actionName, args = {}) {
  const skill = SKILLS[skillName];
  if (!skill) return { error: `unknown skill: ${skillName}` };

  const action = skill.actions[actionName];
  if (!action) return { error: `unknown action: ${actionName} in skill: ${skillName}` };

  try {
    return action.fn(args);
  } catch (err) {
    return { error: `tool execution failed: ${err.message}` };
  }
}

// ── ReAct loop ────────────────────────────────────────────────────────────
// Plan → Execute → Observe → Recover → Answer
// Max 5 iterations before forcing a direct answer.

const MAX_REACT_STEPS = 5;

async function reactLoop(userMessage, fullSystem, history, cfg) {
  const steps = [];
  let finalAnswer = null;
  let needsInput = null; // human-in-the-loop pause

  for (let i = 0; i < MAX_REACT_STEPS; i++) {
    // Build context from previous steps
    const stepContext = steps.length
      ? '\n\n## REACT STEPS COMPLETED\n' + steps.map((s, idx) =>
          `Step ${idx + 1}: ${s.type}\n${JSON.stringify(s.result, null, 2)}`
        ).join('\n\n')
      : '';

    // Ask Anubis to plan or answer
    const planPrompt = `${fullSystem}${stepContext}

## REACT INSTRUCTION
You are in AGENT mode. For each step, respond with EXACTLY ONE of:

THINK: [your reasoning about what to do next]
ACT: [skillName].[actionName] [json args or empty]
ASK: [one clarifying question if you need input from the user]
ANSWER: [your final response to the user]

Current task: ${userMessage}
${steps.length ? `You have completed ${steps.length} step(s). Continue or give ANSWER.` : 'Begin.'}`;

    const planResponse = await callGemini(cfg.geminiApiKey, cfg.model, planPrompt, history);
    if (!planResponse) break;

    const line = planResponse.trim().split('\n')[0].trim();

    // Parse the response
    if (line.startsWith('THINK:')) {
      steps.push({ type: 'THINK', result: { thought: line.replace('THINK:', '').trim() }});
      continue;
    }

    if (line.startsWith('ACT:')) {
      const actStr = line.replace('ACT:', '').trim();
      const [toolRef, ...argParts] = actStr.split(' ');
      const [skillName, actionName] = toolRef.split('.');
      let args = {};
      try { args = JSON.parse(argParts.join(' ') || '{}'); } catch {}

      const toolResult = executeTool(skillName, actionName, args);

      if (toolResult.error) {
        // Recovery — log failure, try again
        steps.push({ type: 'ACT_FAILED', tool: toolRef, result: toolResult });
        steps.push({ type: 'RECOVER', result: { note: `${toolRef} failed. replanning.` }});
      } else {
        steps.push({ type: 'ACT', tool: toolRef, result: toolResult });
      }
      continue;
    }

    if (line.startsWith('ASK:')) {
      // Human-in-the-loop — pause and surface the question
      needsInput = line.replace('ASK:', '').trim();
      break;
    }

    if (line.startsWith('ANSWER:')) {
      finalAnswer = planResponse.replace(/^ANSWER:\s*/i, '').trim();
      break;
    }

    // Fallback — treat entire response as the answer
    finalAnswer = planResponse;
    break;
  }

  return { finalAnswer, needsInput, steps };
}

// ── Gemini API call ───────────────────────────────────────────────────────

function callGemini(apiKey, model, systemInstruction, contents) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 800,
      }
    });

    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || null;
          resolve(text);
        } catch { resolve(null); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── PULSE.md — proactive pulse queue ─────────────────────────────────────

const PULSE_PATH = path.join(__dirname, '..', 'data', 'PULSE.md');

function readPulse() {
  try {
    if (!fs.existsSync(PULSE_PATH)) return [];
    const content = fs.readFileSync(PULSE_PATH, 'utf8');
    return content.split('\n').filter(l => l.startsWith('- ') && !l.includes('[DECLINED]'));
  } catch { return []; }
}

function declinePulse(item) {
  try {
    if (!fs.existsSync(PULSE_PATH)) return;
    let content = fs.readFileSync(PULSE_PATH, 'utf8');
    content = content.replace(item, `${item} [DECLINED]`);
    fs.writeFileSync(PULSE_PATH, content);
  } catch {}
}

function writePulse(item) {
  try {
    const dir = path.dirname(PULSE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(PULSE_PATH, `- ${item}\n`);
  } catch {}
}

// ── OWNER.md — curated owner profile ─────────────────────────────────────

const OWNER_PATH = path.join(__dirname, '..', 'data', 'OWNER.md');

function readOwner() {
  try {
    if (!fs.existsSync(OWNER_PATH)) return '';
    return fs.readFileSync(OWNER_PATH, 'utf8');
  } catch { return ''; }
}

function updateOwner(key, value) {
  try {
    const dir = path.dirname(OWNER_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let content = fs.existsSync(OWNER_PATH)
      ? fs.readFileSync(OWNER_PATH, 'utf8')
      : '# OWNER PROFILE\n\n';
    const regex = new RegExp(`^- \\*\\*${key}\\*\\*:.*$`, 'm');
    const line = `- **${key}**: ${value}`;
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content += `${line}\n`;
    }
    fs.writeFileSync(OWNER_PATH, content);
  } catch {}
}

// ── Auto memory extraction ────────────────────────────────────────────────

const PERSONAL_PATTERNS = [
  /i (feel|felt|am|was|need|want|miss|love|hate|remember|forgot)/i,
  /my (name|job|work|family|dog|phone|goal|dream|fear|plan)/i,
  /i'm (building|working on|trying to|afraid|tired|angry|happy)/i,
  /we (did|built|shipped|lost|won|made)/i,
  /i (just|finally|always|never|used to)/i,
];

function extractMemory(userMessage, response, name) {
  for (const p of PERSONAL_PATTERNS) {
    if (p.test(userMessage)) {
      memory.store(
        `${name} said: "${userMessage.slice(0, 120)}"`,
        ['engine', 'personal'],
        0.85
      );
      break;
    }
  }
}

// ── Layered memory builder ────────────────────────────────────────────────
// persistent (beliefs) + daily (today's events) + discussion (recent turns)

function buildLayeredMemoryBlock(userMessage) {
  const beliefs = memory.getBeliefs().slice(0, 6)
    .map(b => `${b.key}: ${b.value}`).join('\n') || 'still learning';

  const episodic = memory.recall(userMessage, 6)
    .map(m => `- ${m.text}`).join('\n') || 'no relevant memories';

  const owner = readOwner();

  return `## LAYERED MEMORY
### Persistent (core beliefs about this person)
${beliefs}

### Episodic (relevant memories)
${episodic}

${owner ? `### Owner Profile\n${owner}` : ''}`.trim();
}

// ── Main Engine ───────────────────────────────────────────────────────────

class Engine {
  constructor() {
    this._pendingAsk = null; // stores paused ReAct state for human-in-the-loop
  }

  async chat(userMessage) {
    const cfg = config.load();

    // Save user message
    memory.addMessage('user', userMessage);

    // ── Step 1: MODE detection ───────────────────────────────────────────
    const mode = detectMode(userMessage, cfg);

    // ── Step 2: COGNITION ────────────────────────────────────────────────
    const cognitionBlock = cognition.process(userMessage);

    // ── Step 3: IRIS ─────────────────────────────────────────────────────
    const irisReading   = iris.read(userMessage);
    const irisInjection = iris.inject(userMessage);

    // ── Step 4: IMPULSE ──────────────────────────────────────────────────
    const impulseResult    = impulse.evaluate(userMessage, null, irisReading);
    const impulseInjection = impulse.buildInjection(impulseResult);

    // ── Step 5: SOUL ─────────────────────────────────────────────────────
    const baseSystem = soul.buildSystemPrompt(userMessage);

    // ── Step 6: WORLD MODEL ──────────────────────────────────────────────
    const worldSummary = worldModel.getSummary();
    const worldBlock   = worldSummary
      ? `\n## ANUBIS WORLD MODEL\n${worldSummary}`
      : '';

    // ── Step 6b: LAYERED MEMORY ──────────────────────────────────────────
    const memoryBlock = buildLayeredMemoryBlock(userMessage);

    // ── Step 6c: PULSE (proactive items) ─────────────────────────────────
    const pulseItems = readPulse();
    const pulseBlock = pulseItems.length
      ? `\n## PROACTIVE PULSE\nThese are things worth raising when the moment is right:\n${pulseItems.join('\n')}`
      : '';

    // ── Assemble full system prompt ──────────────────────────────────────
    const modeBlock = `\n## EXECUTION MODE: ${mode.toUpperCase()}\n` + {
      [MODES.SMART]:      'Choose the best approach. You decide.',
      [MODES.CONTROLLED]: 'Use only defined skills and actions. No improvisation.',
      [MODES.AGENT]:      'You are in full agent mode. Plan, execute tools, recover from failures, answer.',
    }[mode];

    const fullSystem = [
      baseSystem,
      worldBlock,
      memoryBlock,
      cognitionBlock,
      irisInjection,
      impulseInjection,
      modeBlock,
      pulseBlock,
    ].filter(Boolean).join('\n\n');

    // ── Step 7: Build conversation history ──────────────────────────────
    const history = memory.getHistory(20);
    const contents = history.map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }));

    // ── Step 8: EXECUTE based on mode ───────────────────────────────────
    let reply;

    if (mode === MODES.AGENT) {
      // Full ReAct loop
      const { finalAnswer, needsInput, steps } = await reactLoop(
        userMessage, fullSystem, contents, cfg
      );

      if (needsInput) {
        // Human-in-the-loop — pause, surface the question
        this._pendingAsk = { userMessage, steps };
        reply = needsInput;
      } else {
        reply = finalAnswer || '...';
        this._pendingAsk = null;
      }

      if (process.env.ANUBIS_DEBUG === 'true') {
        console.log('\n[REACT STEPS]', JSON.stringify(steps, null, 2));
      }

    } else {
      // Smart or Controlled — single Gemini call
      const response = await callGemini(cfg.geminiApiKey, cfg.model, fullSystem, contents);
      reply = response || '...';
    }

    // ── Step 9: Save response ─────────────────────────────────────────────
    memory.addMessage('assistant', reply);

    // ── Step 10: Extract memories ─────────────────────────────────────────
    extractMemory(userMessage, reply, cfg.name);

    // ── Step 11: Update world model ───────────────────────────────────────
    worldModel.update(userMessage, reply);

    // ── Debug log ─────────────────────────────────────────────────────────
    if (process.env.ANUBIS_DEBUG === 'true') {
      console.log('\n[MODE]', mode);
      console.log('[COGNITION]', cognitionBlock.slice(0, 200));
      console.log('[IRIS]', irisReading.state, irisReading.confidence);
      if (impulseResult.fire) console.log('[IMPULSE]', impulseResult.trigger);
    }

    return reply;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────

module.exports = new Engine();

// Expose internals for daemon + pulse system
module.exports.writePulse   = writePulse;
module.exports.declinePulse = declinePulse;
module.exports.updateOwner  = updateOwner;
module.exports.SKILLS       = SKILLS;
module.exports.MODES        = MODES;
