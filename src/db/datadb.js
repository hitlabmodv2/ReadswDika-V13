'use strict';

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3');

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'data.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -2000');

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
        const existing = stmtKvGet.get(key);
        if (existing) return;
        const raw  = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        const data = transform ? transform(raw) : raw;
        stmtKvUpsert.run(key, JSON.stringify(data));
        console.log(`\x1b[32m[DataDB]\x1b[39m Migrasi ${path.basename(jsonPath)} → data.db`);
    } catch {}
}

export default db;
