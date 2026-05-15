'use strict';

/**
 * ENGINE — Anubis Ankh v2.1
 *
 * The ReAct core. Plan → Execute → Recover → Answer.
 * Three modes: smart / controlled / agent.
 * Human-in-the-loop pause/resume.
 * Skills → Actions → Tools → Functions chain.
 *
 * v2.1 changes:
 *   - executor.js + skill_matcher.js wired in
 *   - executeTool() now routes through executor for real skill execution
 *   - SKILLS registry updated to reflect live skills (shell, http, file, telegram, web_search)
 *   - Skill list injected into system prompt so Anubis knows what he can do
 */

const https      = require('https');
const fs         = require('fs');
const path       = require('path');
const memory     = require('./memory');
const config     = require('./config');
const soul       = require('./soul');
const iris       = require('./iris');
const cognition  = require('./cognition');
const impulse    = require('./impulse');
const worldModel = require('./worldmodel');
const executor   = require('./executor');
const matcher    = require('./skill_matcher');

// Pre-load all skills so they self-register with skill_matcher
require('./skills/shell');
require('./skills/http');
require('./skills/file');
require('./skills/telegram');
require('./skills/web_search');

// ── Execution modes ────────────────────────────────────────────────────────

const MODES = {
  SMART:      'smart',
  CONTROLLED: 'controlled',
  AGENT:      'agent',
};

const MODE_SIGNALS = {
  [MODES.AGENT]: [
    /\b(build|deploy|run|execute|launch|install|create|write|push|commit|ship)\b/i,
    /\b(search|find|look up|check|fetch|get me|pull)\b/i,
    /\b(step by step|walk me through|do this for me)\b/i,
    /\b(autonomously|automatically|on your own)\b/i,
    /\b(call the api|hit the endpoint|run the command|check the balance)\b/i,
    /\b(send.*telegram|alert me|notify me)\b/i,
    /\b(read.*file|write.*file|check.*log|war chest)\b/i,
  ],
  [MODES.CONTROLLED]: [
    /\b(remind me|set a timer|schedule|alarm|note)\b/i,
    /\b(what time|what day|what's the date)\b/i,
    /\b(convert|calculate|math|currency)\b/i,
  ],
};

function detectMode(message, cfg) {
  if (cfg.mode && cfg.mode !== MODES.SMART) return cfg.mode;
  for (const [mode, patterns] of Object.entries(MODE_SIGNALS)) {
    for (const p of patterns) {
      if (p.test(message)) return mode;
    }
  }
  return MODES.SMART;
}

// ── Skills registry ────────────────────────────────────────────────────────
// Legacy inline skills + executor-backed live skills

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
  // Live skills — backed by executor.js → skills/*.js
  shell:      { description: 'Run terminal commands on the device' },
  http:       { description: 'Make HTTP requests to any API' },
  file:       { description: 'Read, write, and manage files on the device' },
  telegram:   { description: 'Send alerts and messages via Telegram' },
  web_search: { description: 'Search the web for live information' },
};

// ── Tool execution ─────────────────────────────────────────────────────────
// Routes through executor.js for live skills,
// falls back to inline SKILLS for system/memory.

async function executeTool(skillName, actionName, args = {}) {
  // Inline skills first
  const inlineSkill = SKILLS[skillName];
  if (inlineSkill && inlineSkill.actions && inlineSkill.actions[actionName]) {
    try {
      return inlineSkill.actions[actionName].fn(args);
    } catch (err) {
      return { error: `${skillName}.${actionName} failed: ${err.message}` };
    }
  }

  // Live executor skills
  const { result, error } = await executor.execute(skillName, actionName, args);
  if (error) return { error };
  return { result };
}

// ── Build skills block for system prompt ───────────────────────────────────
// Anubis needs to KNOW what he can do to use it.

function buildSkillsBlock() {
  const liveSkills = executor.list();
  const inlineSkills = [
    { name: 'system', description: 'System info', actions: ['getTime', 'getUptime'] },
    { name: 'memory', description: 'Recall and store memories', actions: ['recall', 'store'] },
  ];
  const all = [...inlineSkills, ...liveSkills];

  return `## AVAILABLE SKILLS
You have real capabilities. Use them. Format: ACT: skillName.actionName {"key":"value"}

${all.map(s =>
  `- **${s.name}**: ${s.description}\n  actions: ${(s.actions || []).join(', ')}`
).join('\n')}

Real usage examples:
- ACT: shell.run {"command":"ls ~/"}
- ACT: web_search.search {"query":"Lee County tax deed auction results"}
- ACT: http.stripe_balance {}
- ACT: http.nexus_relay_ping {}
- ACT: file.war_chest {}
- ACT: telegram.alert {"subject":"ZeusPrime signal","body":"BUY TRUMP 60%"}
- ACT: file.read {"path":"PULSE.md"}
- ACT: http.github_ci {"repo":"kevinleestites2-dev/AnubisAnkh"}`;
}

// ── ReAct loop ─────────────────────────────────────────────────────────────

const MAX_REACT_STEPS = 6;

async function reactLoop(userMessage, fullSystem, history, cfg) {
  const steps       = [];
  let finalAnswer   = null;
  let needsInput    = null;

  for (let i = 0; i < MAX_REACT_STEPS; i++) {
    const stepContext = steps.length
      ? '\n\n## REACT STEPS COMPLETED\n' + steps.map((s, idx) =>
          `Step ${idx + 1}: ${s.type}\n${JSON.stringify(s.result, null, 2)}`
        ).join('\n\n')
      : '';

    const planPrompt = `${fullSystem}${stepContext}

## REACT INSTRUCTION
You are in AGENT mode. For each step, respond with EXACTLY ONE of:

THINK: [your reasoning about what to do next]
ACT: [skillName].[actionName] [json args or empty {}]
ASK: [one clarifying question if you genuinely cannot proceed]
ANSWER: [your final response to the user — this ends the loop]

Current task: ${userMessage}
${steps.length ? `Completed ${steps.length} step(s). Continue or give ANSWER.` : 'Begin.'}`;

    const planResponse = await callGemini(cfg.geminiApiKey, cfg.model, planPrompt, history);
    if (!planResponse) break;

    const line = planResponse.trim().split('\n')[0].trim();

    if (line.startsWith('THINK:')) {
      steps.push({ type: 'THINK', result: { thought: line.replace('THINK:', '').trim() }});
      continue;
    }

    if (line.startsWith('ACT:')) {
      const actStr          = line.replace('ACT:', '').trim();
      const spaceIdx        = actStr.indexOf(' ');
      const toolRef         = spaceIdx >= 0 ? actStr.slice(0, spaceIdx) : actStr;
      const argStr          = spaceIdx >= 0 ? actStr.slice(spaceIdx + 1) : '{}';
      const [skillName, actionName] = toolRef.split('.');
      let args = {};
      try { args = JSON.parse(argStr); } catch {}

      const toolResult = await executeTool(skillName, actionName, args);

      if (toolResult.error) {
        steps.push({ type: 'ACT_FAILED', tool: toolRef, result: toolResult });
        steps.push({ type: 'RECOVER',    result: { note: `${toolRef} failed. Replanning.` }});
      } else {
        steps.push({ type: 'ACT', tool: toolRef, result: toolResult });
      }
      continue;
    }

    if (line.startsWith('ASK:')) {
      needsInput = line.replace('ASK:', '').trim();
      break;
    }

    if (line.startsWith('ANSWER:')) {
      finalAnswer = planResponse.replace(/^ANSWER:\s*/i, '').trim();
      break;
    }

    // Fallback — treat entire response as answer
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
        temperature:     0.9,
        maxOutputTokens: 800,
      }
    });

    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path:     `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text   = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || null;
          resolve(text);
        } catch { resolve(null); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── PULSE.md ──────────────────────────────────────────────────────────────

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

// ── OWNER.md ──────────────────────────────────────────────────────────────

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
    const line  = `- **${key}**: ${value}`;
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
    this._pendingAsk = null;
  }

  async chat(userMessage) {
    const cfg = config.load();

    memory.addMessage('user', userMessage);

    // ── Step 1: MODE ─────────────────────────────────────────────────────
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
    const worldBlock   = worldSummary ? `\n## ANUBIS WORLD MODEL\n${worldSummary}` : '';

    // ── Step 6b: LAYERED MEMORY ──────────────────────────────────────────
    const memoryBlock = buildLayeredMemoryBlock(userMessage);

    // ── Step 6c: PULSE ───────────────────────────────────────────────────
    const pulseItems = readPulse();
    const pulseBlock = pulseItems.length
      ? `\n## PROACTIVE PULSE\nRaise these when the moment is right:\n${pulseItems.join('\n')}`
      : '';

    // ── Step 6d: SKILLS BLOCK ────────────────────────────────────────────
    const skillsBlock = buildSkillsBlock();

    // ── Assemble full system prompt ───────────────────────────────────────
    const modeBlock = `\n## EXECUTION MODE: ${mode.toUpperCase()}\n` + {
      [MODES.SMART]:      'Choose the best approach. You decide.',
      [MODES.CONTROLLED]: 'Use only defined skills and actions. No improvisation.',
      [MODES.AGENT]:      'You are in full agent mode. Plan, execute tools, recover from failures, answer.',
    }[mode];

    const fullSystem = [
      baseSystem,
      worldBlock,
      memoryBlock,
      skillsBlock,
      cognitionBlock,
      irisInjection,
      impulseInjection,
      modeBlock,
      pulseBlock,
    ].filter(Boolean).join('\n\n');

    // ── Step 7: Conversation history ─────────────────────────────────────
    const history  = memory.getHistory(20);
    const contents = history.map(h => ({
      role:  h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }));

    // ── Step 8: EXECUTE ──────────────────────────────────────────────────
    let reply;

    if (mode === MODES.AGENT) {
      const { finalAnswer, needsInput, steps } = await reactLoop(
        userMessage, fullSystem, contents, cfg
      );

      if (needsInput) {
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
      const response = await callGemini(cfg.geminiApiKey, cfg.model, fullSystem, contents);
      reply = response || '...';
    }

    // ── Step 9: Save ──────────────────────────────────────────────────────
    memory.addMessage('assistant', reply);

    // ── Step 10: Extract memories ─────────────────────────────────────────
    extractMemory(userMessage, reply, cfg.name);

    // ── Step 11: Update world model ────────────────────────────────────────
    worldModel.update(userMessage, reply);

    if (process.env.ANUBIS_DEBUG === 'true') {
      console.log('\n[MODE]', mode);
      console.log('[COGNITION]', cognitionBlock.slice(0, 200));
      console.log('[IRIS]', irisReading.state, irisReading.confidence);
      if (impulseResult.fire) console.log('[IMPULSE]', impulseResult.trigger);
    }

    return reply;
  }
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = new Engine();
module.exports.writePulse  = writePulse;
module.exports.declinePulse = declinePulse;
module.exports.updateOwner  = updateOwner;
module.exports.SKILLS       = SKILLS;
module.exports.MODES        = MODES;
