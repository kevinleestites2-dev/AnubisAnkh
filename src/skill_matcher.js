'use strict';

/**
 * SKILL MATCHER — Anubis Ankh
 *
 * Given a natural language request, finds the best matching skill + action.
 * Used by executor.js before falling back to full ReAct loop.
 *
 * Each skill registers:
 *   - triggers: regex patterns that strongly signal this skill
 *   - actions: what the skill can do
 *   - extract: function to pull args from the message
 */

const REGISTRY = [];

function register(skill) {
  REGISTRY.push(skill);
}

function match(message) {
  const msg = message.toLowerCase().trim();

  for (const skill of REGISTRY) {
    for (const trigger of skill.triggers) {
      if (trigger.test(msg)) {
        // Find best action within the skill
        const action = skill.defaultAction || skill.actions[0];
        const args   = skill.extract ? skill.extract(message) : {};
        return { skill: skill.name, action, args, confidence: 0.85 };
      }
    }
  }

  return null; // no match — caller falls through to ReAct loop
}

function listSkills() {
  return REGISTRY.map(s => ({
    name:        s.name,
    description: s.description,
    actions:     s.actions,
    triggers:    s.triggers.map(t => t.toString()),
  }));
}

module.exports = { register, match, listSkills };
