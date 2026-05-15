'use strict';

/**
 * SKILL: file
 *
 * Read, write, append, and list files on the device.
 * Anubis uses this to:
 *   - Update OWNER.md and PULSE.md in real time
 *   - Read war chest logs (war_chest.json)
 *   - Write notes, summaries, action logs
 *   - Monitor any file for changes
 *
 * Root path defaults to the repo's data/ directory.
 * Absolute paths are allowed but capped to the user's home dir.
 */

const fs   = require('fs');
const path = require('path');
const skill_matcher = require('../skill_matcher');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const HOME_DIR = process.env.HOME || '/data/data/com.termux/files/home';

function safePath(filePath) {
  // Allow absolute paths within home or data dir; else resolve from DATA_DIR
  if (path.isAbsolute(filePath)) {
    if (filePath.startsWith(HOME_DIR) || filePath.startsWith(DATA_DIR)) return filePath;
    // Reject paths outside home
    return null;
  }
  return path.join(DATA_DIR, filePath);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const MAX_READ = 8000;

const actions = {

  read: async ({ path: filePath, lines }) => {
    if (!filePath) return 'no path provided';
    const resolved = safePath(filePath);
    if (!resolved) return `access denied: path must be within home directory`;
    if (!fs.existsSync(resolved)) return `file not found: ${filePath}`;

    const content = fs.readFileSync(resolved, 'utf8');
    if (lines) {
      const linesArr = content.split('\n').slice(0, parseInt(lines));
      return linesArr.join('\n');
    }
    return content.length > MAX_READ
      ? content.slice(0, MAX_READ) + '\n... [truncated]'
      : content;
  },

  write: async ({ path: filePath, content }) => {
    if (!filePath) return 'no path provided';
    if (content === undefined) return 'no content provided';
    const resolved = safePath(filePath);
    if (!resolved) return `access denied`;
    ensureDir(resolved);
    fs.writeFileSync(resolved, content, 'utf8');
    return `written: ${filePath} (${Buffer.byteLength(content)} bytes)`;
  },

  append: async ({ path: filePath, content }) => {
    if (!filePath) return 'no path provided';
    if (!content) return 'no content provided';
    const resolved = safePath(filePath);
    if (!resolved) return `access denied`;
    ensureDir(resolved);
    fs.appendFileSync(resolved, content + '\n', 'utf8');
    return `appended to: ${filePath}`;
  },

  list: async ({ path: dirPath, ext }) => {
    const resolved = safePath(dirPath || '');
    if (!resolved || !fs.existsSync(resolved)) return 'directory not found';
    const files = fs.readdirSync(resolved)
      .filter(f => !ext || f.endsWith(ext))
      .map(f => {
        const stat = fs.statSync(path.join(resolved, f));
        return `${stat.isDirectory() ? 'd' : '-'} ${f} (${stat.size}b)`;
      });
    return files.join('\n') || '(empty directory)';
  },

  exists: async ({ path: filePath }) => {
    if (!filePath) return 'no path provided';
    const resolved = safePath(filePath);
    return resolved && fs.existsSync(resolved) ? 'yes' : 'no';
  },

  delete: async ({ path: filePath }) => {
    if (!filePath) return 'no path provided';
    const resolved = safePath(filePath);
    if (!resolved) return 'access denied';
    if (!fs.existsSync(resolved)) return 'file not found';
    fs.unlinkSync(resolved);
    return `deleted: ${filePath}`;
  },

  // ── Pantheon-specific shortcuts ────────────────────────────────────────

  war_chest: async () => {
    const wcPath = path.join(HOME_DIR, 'logs', 'war_chest.json');
    if (!fs.existsSync(wcPath)) return 'war_chest.json not found — MidasPrime may not be running';
    const data = JSON.parse(fs.readFileSync(wcPath, 'utf8'));
    return JSON.stringify(data, null, 2);
  },

  pulse_add: async ({ item }) => {
    if (!item) return 'no item provided';
    const pulsePath = path.join(DATA_DIR, 'PULSE.md');
    ensureDir(pulsePath);
    fs.appendFileSync(pulsePath, `- ${item}\n`, 'utf8');
    return `added to PULSE: ${item}`;
  },

};

// ── Register with skill_matcher ────────────────────────────────────────────

skill_matcher.register({
  name:          'file',
  description:   'Read, write, and manage files on the device',
  defaultAction: 'read',
  actions:       Object.keys(actions),
  triggers: [
    /\b(read|open|show me|print|cat)\s+.*(file|\.md|\.json|\.txt|\.log|\.py|\.js)\b/i,
    /\b(write|save|create|append).*(file|note|log)\b/i,
    /\b(war chest|pulse\.md|owner\.md)\b/i,
    /\b(does .* exist|is .* there)\b/i,
  ],
  extract: (msg) => {
    const fileMatch = msg.match(/[\w\/.-]+\.(md|json|txt|log|py|js|sh)/i);
    return fileMatch ? { path: fileMatch[0] } : {};
  },
});

module.exports = {
  name:        'file',
  description: 'File operations — read, write, append, list',
  actions,
};
