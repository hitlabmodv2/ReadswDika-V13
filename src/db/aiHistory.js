'use strict';

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3');

const DATA_DIR             = path.join(process.cwd(), 'data');
const DB_PATH              = path.join(DATA_DIR, 'data.db');
const EXPIRE_MS            = 6 * 60 * 60 * 1000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_TEXT_PER_MESSAGE = 1500;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -2000');

db.exec(`
    CREATE TABLE IF NOT EXISTS ai_history (
        session_key   TEXT PRIMARY KEY,
        messages      TEXT NOT NULL DEFAULT '[]',
        last_activity INTEGER NOT NULL
    );
`);

const stmtGet       = db.prepare('SELECT messages, last_activity FROM ai_history WHERE session_key = ?');
const stmtUpsert    = db.prepare(`
    INSERT INTO ai_history (session_key, messages, last_activity) VALUES (?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET messages = excluded.messages, last_activity = excluded.last_activity
`);
const stmtDelete    = db.prepare('DELETE FROM ai_history WHERE session_key = ?');
const stmtDeleteAll = db.prepare('DELETE FROM ai_history');
const stmtCount     = db.prepare('SELECT COUNT(*) as c FROM ai_history');

/* ── Auto-migrasi dari data/ai_history/*.json ── */
(function migrateFromJSON() {
    try {
        const histDir = path.join(DATA_DIR, 'ai_history');
        if (!fs.existsSync(histDir)) return;
        const existing = stmtCount.get().c;
        if (existing > 0) return;

        const files = fs.readdirSync(histDir).filter(f => f.endsWith('.json'));
        if (!files.length) return;

        const items = [];
        for (const file of files) {
            try {
                const sessionKey = file.replace('.json', '');
                const raw        = JSON.parse(fs.readFileSync(path.join(histDir, file), 'utf-8'));
                items.push([sessionKey, JSON.stringify(raw.messages || []), raw.lastActivity || Date.now()]);
            } catch {}
        }
        if (!items.length) return;

        db.transaction(() => {
            for (const [k, msgs, ts] of items) stmtUpsert.run(k, msgs, ts);
        })();
        console.log(`\x1b[32m[AiHistory]\x1b[39m Migrasi ${items.length} sesi dari JSON → data.db`);
    } catch {}
})();

/* ── Helpers ── */
function fmtTime(ts) {
    try {
        return new Date(ts).toLocaleString('id-ID', {
            hour: '2-digit', minute: '2-digit',
            day: '2-digit', month: 'short',
            timeZone: 'Asia/Jakarta',
        });
    } catch {
        return new Date(ts).toISOString();
    }
}

function enrichUserText(userText, meta = {}) {
    const ts   = meta.timestamp || Date.now();
    const tags = [`⏰ ${fmtTime(ts)}`];

    if (meta.quotedBotText) {
        const q       = String(meta.quotedBotText).replace(/\s+/g, ' ').trim();
        const excerpt = q.length > 140 ? q.slice(0, 140) + '...' : q;
        tags.push(`↩️ BALAS PESAN BOT SEBELUMNYA: "${excerpt}"`);
    } else if (meta.isReplyToBot) {
        tags.push('↩️ BALAS PESAN BOT SEBELUMNYA');
    }

    if (meta.mediaLabel) tags.push(`📎 KIRIM ${String(meta.mediaLabel).toUpperCase()}`);
    if (meta.userName)   tags.push(`👤 ${meta.userName}`);

    const tagBlock = `[${tags.join(' | ')}]`;
    return userText && userText.trim().length > 0
        ? `${tagBlock}\n${userText}`
        : tagBlock;
}

function enrichBotText(botText, meta = {}) {
    return `[⏰ ${fmtTime(meta.timestamp || Date.now())}]\n${botText}`;
}

function clip(text, max) {
    if (!text) return text;
    const s = String(text);
    if (s.length <= max) return s;
    return s.slice(0, max) + ` …(+${s.length - max} char dipotong)`;
}

/* ── Public API ── */
export function getHistory(sessionKey) {
    const row = stmtGet.get(sessionKey);
    if (!row) return [];

    if (Date.now() - row.last_activity > EXPIRE_MS) {
        stmtDelete.run(sessionKey);
        return [];
    }

    try { return JSON.parse(row.messages) || []; } catch { return []; }
}

export function addToHistory(sessionKey, userText, botText, meta = {}) {
    const row      = stmtGet.get(sessionKey);
    const messages = row ? (() => { try { return JSON.parse(row.messages); } catch { return []; } })() : [];
    const ts       = Date.now();
    const sharedMeta = { ...meta, timestamp: meta.timestamp || ts };

    messages.push({ role: 'user',  parts: [{ text: enrichUserText(clip(userText, MAX_TEXT_PER_MESSAGE), sharedMeta) }] });
    messages.push({ role: 'model', parts: [{ text: enrichBotText(clip(botText,  MAX_TEXT_PER_MESSAGE), { timestamp: ts }) }] });

    while (messages.length > MAX_HISTORY_MESSAGES) {
        messages.splice(0, 2);
    }

    stmtUpsert.run(sessionKey, JSON.stringify(messages), ts);
}

export function wrapCurrentUserMessage(userText, meta = {}) {
    const ts   = meta.timestamp || Date.now();
    const tags = [`⏰ ${fmtTime(ts)}`];
    if (meta.quotedBotText) {
        const q       = String(meta.quotedBotText).replace(/\s+/g, ' ').trim();
        const excerpt = q.length > 140 ? q.slice(0, 140) + '...' : q;
        tags.push(`↩️ BALAS PESAN BOT: "${excerpt}"`);
    }
    if (meta.mediaLabel) tags.push(`📎 ${String(meta.mediaLabel).toUpperCase()}`);
    if (meta.userName)   tags.push(`👤 ${meta.userName}`);

    const header = `━━━ 💬 PESAN BARU DARI USER — JAWAB INI SEKARANG ━━━\n[${tags.join(' | ')}]`;
    const body   = (userText && userText.trim().length > 0) ? `\n${userText}` : '';
    const footer = `\n━━━ (akhir pesan baru) ━━━`;
    return header + body + footer;
}

export function buildHistoryMeta(m, extra = {}) {
    const meta = { timestamp: Date.now(), ...extra };
    try {
        if (m?.isQuoted && m?.quoted?.key?.fromMe) {
            meta.isReplyToBot = true;
            const q = m.quoted?.text || m.quoted?.caption || m.quoted?.body || '';
            if (q) meta.quotedBotText = q;
        }
        if (m?.pushName && !meta.userName) meta.userName = m.pushName;
    } catch {}
    return meta;
}

export function clearHistory(sessionKey) {
    stmtDelete.run(sessionKey);
}

export function clearAllHistory() {
    const { c } = stmtCount.get();
    stmtDeleteAll.run();
    return c;
}

export function countHistory() {
    return stmtCount.get().c;
}

export function getSessionKey(m) {
    return m.isGroup ? `${m.sender}_${m.from}` : m.sender;
}
