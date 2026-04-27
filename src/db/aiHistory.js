/**
 * ───────────────────────────────
 *  Base Script : Bang Dika Ardnt
 *  Recode By   : Bang Wilykun
 *  WhatsApp    : 6289688206739
 *  Telegram    : @Wilykun1994
 * ───────────────────────────────
 *  Script ini khusus donasi/VIP
 *  Support dari kalian bikin saya
 *  makin semangat update fitur,
 *  fix bug, dan rawat script ini.
 *
 *  Dilarang menjual ulang script ini
 *  Tanpa izin resmi dari developer.
 *  Jika ketahuan = NO UPDATE / NO FIX
 *
 *  Hargai karya, gunakan dengan bijak.
 *  Terima kasih sudah support.
 * ───────────────────────────────
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'ai_history');
const EXPIRE_MS = 6 * 60 * 60 * 1000;

if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
}

function safeKey(key) {
        return key.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function getFilePath(sessionKey) {
        return path.join(DATA_DIR, safeKey(sessionKey) + '.json');
}

function loadSession(sessionKey) {
        const filePath = getFilePath(sessionKey);
        try {
                if (!fs.existsSync(filePath)) return null;
                const raw = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(raw);
        } catch {
                return null;
        }
}

function saveSession(sessionKey, data) {
        const filePath = getFilePath(sessionKey);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function getHistory(sessionKey) {
        const session = loadSession(sessionKey);
        if (!session) return [];

        const now = Date.now();
        if (now - session.lastActivity > EXPIRE_MS) {
                clearHistory(sessionKey);
                return [];
        }

        return session.messages || [];
}

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
        const ts = meta.timestamp || Date.now();
        const timeStr = fmtTime(ts);
        const tags = [`⏰ ${timeStr}`];

        if (meta.quotedBotText) {
                const q = String(meta.quotedBotText).replace(/\s+/g, ' ').trim();
                const excerpt = q.length > 140 ? q.slice(0, 140) + '...' : q;
                tags.push(`↩️ BALAS PESAN BOT SEBELUMNYA: "${excerpt}"`);
        } else if (meta.isReplyToBot) {
                tags.push('↩️ BALAS PESAN BOT SEBELUMNYA');
        }

        if (meta.mediaLabel) {
                tags.push(`📎 KIRIM ${String(meta.mediaLabel).toUpperCase()}`);
        }
        if (meta.userName) {
                tags.push(`👤 ${meta.userName}`);
        }

        const tagBlock = `[${tags.join(' | ')}]`;
        return userText && userText.trim().length > 0
                ? `${tagBlock}\n${userText}`
                : tagBlock;
}

function enrichBotText(botText, meta = {}) {
        const ts = meta.timestamp || Date.now();
        return `[⏰ ${fmtTime(ts)}]\n${botText}`;
}

export function addToHistory(sessionKey, userText, botText, meta = {}) {
        const session = loadSession(sessionKey) || { messages: [], lastActivity: Date.now() };
        const ts = Date.now();
        const sharedMeta = { ...meta, timestamp: meta.timestamp || ts };

        session.messages.push({ role: 'user', parts: [{ text: enrichUserText(userText, sharedMeta) }] });
        session.messages.push({ role: 'model', parts: [{ text: enrichBotText(botText, { timestamp: ts }) }] });

        session.lastActivity = ts;
        saveSession(sessionKey, session);
}

export function buildHistoryMeta(m, extra = {}) {
        const meta = { timestamp: Date.now(), ...extra };
        try {
                if (m?.isQuoted && m?.quoted?.key?.fromMe) {
                        meta.isReplyToBot = true;
                        const q = m.quoted?.text || m.quoted?.caption || m.quoted?.body || '';
                        if (q) meta.quotedBotText = q;
                }
                if (m?.pushName && !meta.userName) {
                        meta.userName = m.pushName;
                }
        } catch {}
        return meta;
}

export function clearHistory(sessionKey) {
        const filePath = getFilePath(sessionKey);
        try {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {}
}

export function clearAllHistory() {
        try {
                const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
                for (const file of files) {
                        try { fs.unlinkSync(path.join(DATA_DIR, file)); } catch {}
                }
                return files.length;
        } catch {
                return 0;
        }
}

export function countHistory() {
        try {
                return fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).length;
        } catch {
                return 0;
        }
}

export function getSessionKey(m) {
        if (m.isGroup) {
                return `${m.sender}_${m.from}`;
        }
        return m.sender;
}
