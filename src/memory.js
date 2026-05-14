'use strict';
/**
 * MEMORY — Anubis Ankh
 *
 * Self-organizing memory. Anubis remembers everything.
 * Beliefs stored with confidence scores.
 * He knows what he knows. He knows what he's unsure of.
 * "You carried this before."
 */

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_DIR  = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'anubis.db');

let _db = null;

function db() {
  if (_db) return _db;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      text       TEXT    NOT NULL,
      tags       TEXT    DEFAULT '[]',
      confidence REAL    DEFAULT 1.0,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      access_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      role       TEXT    NOT NULL,
      content    TEXT    NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS beliefs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      key        TEXT    NOT NULL UNIQUE,
      value      TEXT    NOT NULL,
      confidence REAL    DEFAULT 1.0,
      source     TEXT    DEFAULT 'observed',
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
  return _db;
}

// ── Memories (episodic — moments, facts, observations) ─────────────────────

function store(text, tags = [], confidence = 1.0) {
  db().prepare(`
    INSERT INTO memories (text, tags, confidence)
    VALUES (?, ?, ?)
  `).run(text, JSON.stringify(tags), confidence);
}

function recall(query = '', limit = 8) {
  // Simple keyword search — good enough for mobile SQLite
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (!words.length) {
    return db().prepare(`
      SELECT * FROM memories ORDER BY access_count DESC, created_at DESC LIMIT ?
    `).all(limit);
  }

  const conditions = words.map(() => `LOWER(text) LIKE ?`).join(' OR ');
  const params     = words.map(w => `%${w}%`);
  const rows       = db().prepare(`
    SELECT * FROM memories WHERE ${conditions}
    ORDER BY confidence DESC, access_count DESC LIMIT ?
  `).all(...params, limit);

  // Bump access count
  if (rows.length) {
    const ids = rows.map(r => r.id).join(',');
    db().exec(`UPDATE memories SET access_count = access_count + 1 WHERE id IN (${ids})`);
  }

  return rows;
}

function forget(id) {
  db().prepare(`DELETE FROM memories WHERE id = ?`).run(id);
}

// ── Beliefs (core truths about the person) ─────────────────────────────────

function believe(key, value, confidence = 1.0, source = 'observed') {
  db().prepare(`
    INSERT INTO beliefs (key, value, confidence, source, updated_at)
    VALUES (?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET
      value      = excluded.value,
      confidence = excluded.confidence,
      source     = excluded.source,
      updated_at = strftime('%s','now')
  `).run(key, value, confidence, source);
}

function getBeliefs() {
  return db().prepare(`SELECT * FROM beliefs ORDER BY confidence DESC`).all();
}

// ── Conversation history ───────────────────────────────────────────────────

function addMessage(role, content) {
  db().prepare(`
    INSERT INTO conversations (role, content) VALUES (?, ?)
  `).run(role, content);
}

function getHistory(limit = 20) {
  return db().prepare(`
    SELECT role, content FROM conversations
    ORDER BY created_at DESC LIMIT ?
  `).all(limit).reverse();
}

function clearHistory() {
  db().prepare(`DELETE FROM conversations`).run();
}

module.exports = { store, recall, forget, believe, getBeliefs, addMessage, getHistory, clearHistory, db };
