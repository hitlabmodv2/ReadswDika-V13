'use strict';

import path from 'path';
import fs from 'fs';
import db, { stmtUserGet, stmtUserUpsert } from './datadb.js';

const DATA_DIR = path.join(process.cwd(), 'data');

/* ── Auto-migrasi dari data/users/*.json ── */
(function migrateFromJSON() {
    try {
        const usersDir = path.join(DATA_DIR, 'users');
        if (!fs.existsSync(usersDir)) return;

        const existing = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
        if (existing > 0) return;

        const files = fs.readdirSync(usersDir).filter(f => f.endsWith('.json'));
        if (!files.length) return;

        db.transaction(() => {
            for (const file of files) {
                try {
                    const id  = file.replace('.json', '');
                    const raw = fs.readFileSync(path.join(usersDir, file), 'utf-8');
                    stmtUserUpsert.run(id, raw);
                } catch {}
            }
        })();
        console.log(`\x1b[32m[UserDB]\x1b[39m Migrasi ${files.length} user dari JSON → data.db`);
    } catch {}
})();

/* ── Helpers ── */
function sanitizeSender(sender) {
    return (sender || '').split('@')[0].replace(/[^0-9a-zA-Z_-]/g, '');
}

export function getUserData(sender) {
    const id = sanitizeSender(sender);
    if (!id) return {};
    const row = stmtUserGet.get(id);
    if (!row) return {};
    try { return JSON.parse(row.data); } catch { return {}; }
}

export function saveUserData(sender, data) {
    const id = sanitizeSender(sender);
    if (!id) return;
    stmtUserUpsert.run(id, JSON.stringify(data));
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
