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
`);

const stmtGet    = db.prepare('SELECT data FROM users WHERE id = ?');
const stmtUpsert = db.prepare(`
    INSERT INTO users (id, data, updated_at) VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);

/* ── Auto-migrasi dari data/users/*.json ── */
(function migrateFromJSON() {
    try {
        const usersDir = path.join(DATA_DIR, 'users');
        if (!fs.existsSync(usersDir)) return;
        const existing = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
        if (existing > 0) return;

        const files = fs.readdirSync(usersDir).filter(f => f.endsWith('.json'));
        if (!files.length) return;

        const items = [];
        for (const file of files) {
            try {
                const id  = file.replace('.json', '');
                const raw = fs.readFileSync(path.join(usersDir, file), 'utf-8');
                items.push([id, raw]);
            } catch {}
        }
        if (!items.length) return;

        db.transaction(() => {
            for (const [id, raw] of items) stmtUpsert.run(id, raw);
        })();
        console.log(`\x1b[32m[UserDB]\x1b[39m Migrasi ${items.length} user dari JSON → data.db`);
    } catch {}
})();

/* ── Helpers ── */
function sanitizeSender(sender) {
    return (sender || '').split('@')[0].replace(/[^0-9a-zA-Z_-]/g, '');
}

export function getUserData(sender) {
    const id = sanitizeSender(sender);
    if (!id) return {};
    const row = stmtGet.get(id);
    if (!row) return {};
    try { return JSON.parse(row.data); } catch { return {}; }
}

export function saveUserData(sender, data) {
    const id = sanitizeSender(sender);
    if (!id) return;
    stmtUpsert.run(id, JSON.stringify(data));
}

export function updateUserName(sender, name) {
    if (!sender || !name || !name.trim()) return;
    const data = getUserData(sender);
    const trimmedName = name.trim();
    let changed = false;
    if (data.name !== trimmedName) {
        data.name      = trimmedName;
        data.updatedAt = new Date().toISOString();
        changed = true;
    }
    if (!data.firstSeen) {
        data.firstSeen = new Date().toISOString();
        changed = true;
    }
    if (changed) saveUserData(sender, data);
}

export function getUserName(sender, fallback = 'Kak') {
    return getUserData(sender).name || fallback;
}

export function setUserExtra(sender, key, value) {
    const data = getUserData(sender);
    data[key] = value;
    saveUserData(sender, data);
}

export function getUserExtra(sender, key) {
    return getUserData(sender)[key];
}
