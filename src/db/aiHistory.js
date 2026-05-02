'use strict';

import path from 'path';
import fs from 'fs';
import db, { stmtAiGet, stmtAiUpsert, stmtAiDelete, stmtAiDeleteAll, stmtAiCount } from './datadb.js';

const DATA_DIR             = path.join(process.cwd(), 'data');
const EXPIRE_MS            = 6 * 60 * 60 * 1000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_TEXT_PER_MESSAGE = 1500;

/* ── Auto-migrasi dari data/ai_history/*.json ── */
(function migrateFromJSON() {
    try {
        const histDir = path.join(DATA_DIR, 'ai_history');
        if (!fs.existsSync(histDir)) return;

        const existing = stmtAiCount.get().c;
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
            for (const [k, msgs, ts] of items) stmtAiUpsert.run(k, msgs, ts);
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
    const row = stmtAiGet.get(sessionKey);
    if (!row) return [];

    if (Date.now() - row.last_activity > EXPIRE_MS) {
        stmtAiDelete.run(sessionKey);
        return [];
    }

    try { return JSON.parse(row.messages) || []; } catch { return []; }
}

export function addToHistory(sessionKey, userText, botText, meta = {}) {
    const row      = stmtAiGet.get(sessionKey);
    const messages = row ? (() => { try { return JSON.parse(row.messages); } catch { return []; } })() : [];
    const ts       = Date.now();
    const sharedMeta = { ...meta, timestamp: meta.timestamp || ts };

    messages.push({ role: 'user',  parts: [{ text: enrichUserText(clip(userText, MAX_TEXT_PER_MESSAGE), sharedMeta) }] });
    messages.push({ role: 'model', parts: [{ text: enrichBotText(clip(botText,  MAX_TEXT_PER_MESSAGE), { timestamp: ts }) }] });

    while (messages.length > MAX_HISTORY_MESSAGES) {
        messages.splice(0, 2);
    }

    stmtAiUpsert.run(sessionKey, JSON.stringify(messages), ts);
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
    stmtAiDelete.run(sessionKey);
}

export function clearAllHistory() {
    const { c } = stmtAiCount.get();
    stmtAiDeleteAll.run();
    return c;
}

export function countHistory() {
    return stmtAiCount.get().c;
}

export function getSessionKey(m) {
    return m.isGroup ? `${m.sender}_${m.from}` : m.sender;
}
