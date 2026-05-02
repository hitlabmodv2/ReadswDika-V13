'use strict';

import path from 'path';
import fs from 'fs';
import { getSharedDb } from '../../lib/dbPool.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'data.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Gunakan pool global — satu koneksi untuk data.db
const db = getSharedDb(DB_PATH);

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id         TEXT PRIMARY KEY,
        data       TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS ai_history (
        session_key   TEXT PRIMARY KEY,
        messages      TEXT NOT NULL DEFAULT '[]',
        last_activity INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
`);

export const stmtUserGet    = db.prepare('SELECT data FROM users WHERE id = ?');
export const stmtUserUpsert = db.prepare(`
    INSERT INTO users (id, data, updated_at) VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);

export const stmtAiGet       = db.prepare('SELECT messages, last_activity FROM ai_history WHERE session_key = ?');
export const stmtAiUpsert    = db.prepare(`
    INSERT INTO ai_history (session_key, messages, last_activity) VALUES (?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET messages = excluded.messages, last_activity = excluded.last_activity
`);
export const stmtAiDelete    = db.prepare('DELETE FROM ai_history WHERE session_key = ?');
export const stmtAiDeleteAll = db.prepare('DELETE FROM ai_history');
export const stmtAiCount     = db.prepare('SELECT COUNT(*) as c FROM ai_history');

const stmtKvGet    = db.prepare('SELECT value FROM kv WHERE key = ?');
const stmtKvUpsert = db.prepare(`
    INSERT INTO kv (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

export function kvGet(key, fallback = null) {
    const row = stmtKvGet.get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
}

export function kvSet(key, value) {
    stmtKvUpsert.run(key, JSON.stringify(value));
}

export function kvMigrateFromJSON(key, jsonPath, transform = null) {
    try {
        if (!fs.existsSync(jsonPath)) return;
        if (stmtKvGet.get(key)) return;
        const raw  = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        const data = transform ? transform(raw) : raw;
        stmtKvUpsert.run(key, JSON.stringify(data));
        console.log(`\x1b[32m[DataDB]\x1b[39m Migrasi ${path.basename(jsonPath)} → data.db`);
    } catch {}
}

export default db;
