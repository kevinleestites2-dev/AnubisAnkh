'use strict';

/**
 * EXECUTOR — Anubis Ankh
 *
 * The hands. Takes a skill + action + args and runs it.
 * Returns { result, error, raw } — always an object, never throws.
 *
 * Flow:
 *   engine.js (ReAct loop)
 *     → skill_matcher.js (what skill handles this?)
 *       → executor.js (run it, return the result)
 *         → skills/*.js (the actual implementation)
 *
 * Skills are loaded lazily on first use.
 * Each skill module must export: { name, description, actions: { [name]: async fn } }
 */

const path = require('path');
const SKILLS_DIR = path.join(__dirname, 'skills');

const _cache = {};

function loadSkill(skillName) {
  if (_cache[skillName]) return _cache[skillName];
  try {
    const skill = require(path.join(SKILLS_DIR, `${skillName}.js`));
    _cache[skillName] = skill;
    return skill;
  } catch (err) {
    return null;
  }
}

async function execute(skillName, actionName, args = {}) {
  const skill = loadSkill(skillName);

  if (!skill) {
    return { error: `skill not found: ${skillName}` };
  }

  const action = skill.actions && skill.actions[actionName];
  if (!action) {
    return { error: `action not found: ${skillName}.${actionName}` };
  }

  try {
    const raw = await action(args);
    return { result: raw, error: null };
  } catch (err) {
    return { result: null, error: `${skillName}.${actionName} failed: ${err.message}` };
  }
}

// List all available skills + their actions
function list() {
  const fs = require('fs');
  try {
    const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.js'));
    return files.map(f => {
      const skill = loadSkill(f.replace('.js', ''));
      return skill ? { name: skill.name, description: skill.description, actions: Object.keys(skill.actions || {}) } : null;
    }).filter(Boolean);
  } catch { return []; }
}

module.exports = { execute, list, loadSkill };
