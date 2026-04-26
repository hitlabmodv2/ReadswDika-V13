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

export function addToHistory(sessionKey, userText, botText) {
        const session = loadSession(sessionKey) || { messages: [], lastActivity: Date.now() };

        session.messages.push({ role: 'user', parts: [{ text: userText }] });
        session.messages.push({ role: 'model', parts: [{ text: botText }] });

        session.lastActivity = Date.now();
        saveSession(sessionKey, session);
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
