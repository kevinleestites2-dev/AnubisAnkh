'use strict';

/**
 * SKILL: shell
 *
 * Run terminal commands on the device.
 * This is what makes Anubis an OS agent.
 *
 * On the Red Magic: runs in Termux environment.
 * On any machine: runs in the shell where node was launched.
 *
 * Safety:
 *   - Blocked commands list prevents catastrophic ops
 *   - Timeout: 30s max per command
 *   - Output capped at 4000 chars to stay in context window
 */

const { execSync } = require('child_process');
const skill_matcher = require('../skill_matcher');

const BLOCKED = [
  /\brm\s+-rf\s+\/\b/,        // rm -rf /
  /\bmkfs\b/,                  // format drive
  /\bdd\s+if=.*of=\/dev\//,    // disk write
  /\bshutdown\b/,
  /\breboot\b/,
  /\bpkill\s+-9\s+all\b/,
];

const MAX_OUTPUT = 4000;
const TIMEOUT_MS = 30000;

function isBlocked(cmd) {
  return BLOCKED.some(pattern => pattern.test(cmd));
}

const actions = {

  run: async ({ command, cwd }) => {
    if (!command) return 'no command provided';
    if (isBlocked(command)) return `blocked: this command is not permitted`;

    try {
      const output = execSync(command, {
        cwd: cwd || process.env.HOME || '/data/data/com.termux/files/home',
        timeout: TIMEOUT_MS,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const trimmed = (output || '').trim();
      return trimmed.length > MAX_OUTPUT
        ? trimmed.slice(0, MAX_OUTPUT) + '\n... [output truncated]'
        : trimmed || '(command completed — no output)';
    } catch (err) {
      const stderr = (err.stderr || '').trim();
      const stdout = (err.stdout || '').trim();
      const msg    = stderr || stdout || err.message;
      return `error: ${msg.slice(0, MAX_OUTPUT)}`;
    }
  },

  which: async ({ program }) => {
    if (!program) return 'no program specified';
    try {
      return execSync(`which ${program}`, { encoding: 'utf8', timeout: 5000 }).trim();
    } catch {
      return `${program} not found`;
    }
  },

  env: async ({ key }) => {
    if (key) return process.env[key] || `${key} not set`;
    const safe = ['HOME', 'PATH', 'USER', 'TERM', 'SHELL', 'PWD', 'TMPDIR'];
    return safe.map(k => `${k}=${process.env[k] || ''}`).join('\n');
  },

};

// ── Register with skill_matcher ────────────────────────────────────────────

skill_matcher.register({
  name:          'shell',
  description:   'Run terminal commands on the device',
  defaultAction: 'run',
  actions:       Object.keys(actions),
  triggers: [
    /\b(run|execute|terminal|shell|bash|command)\b/i,
    /\b(ls|cd|cat|grep|find|chmod|mkdir|touch|echo)\b/,
    /\b(pkg install|npm|pip|git|node)\b/i,
    /\b(check if .+ is running|is .+ installed)\b/i,
  ],
  extract: (msg) => ({ command: msg }),
});

module.exports = {
  name:        'shell',
  description: 'Run terminal commands — OS agent capability',
  actions,
};
