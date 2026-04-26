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

const USERS_DIR = path.join(process.cwd(), 'data', 'users');

if (!fs.existsSync(USERS_DIR)) {
    fs.mkdirSync(USERS_DIR, { recursive: true });
}

function sanitizeSender(sender) {
    return (sender || '').split('@')[0].replace(/[^0-9a-zA-Z_-]/g, '');
}

export function getUserData(sender) {
    const id = sanitizeSender(sender);
    if (!id) return {};
    const filePath = path.join(USERS_DIR, `${id}.json`);
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (_) {}
    return {};
}

export function saveUserData(sender, data) {
    const id = sanitizeSender(sender);
    if (!id) return;
    const filePath = path.join(USERS_DIR, `${id}.json`);
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (_) {}
}

export function updateUserName(sender, name) {
    if (!sender || !name || name.trim().length < 1) return;
    const data = getUserData(sender);
    const trimmedName = name.trim();
    if (data.name !== trimmedName) {
        data.name = trimmedName;
        data.updatedAt = new Date().toISOString();
        saveUserData(sender, data);
    }
    if (!data.firstSeen) {
        data.firstSeen = new Date().toISOString();
        saveUserData(sender, data);
    }
}

export function getUserName(sender, fallback = 'Kak') {
    const data = getUserData(sender);
    return data.name || fallback;
}

export function setUserExtra(sender, key, value) {
    const data = getUserData(sender);
    data[key] = value;
    saveUserData(sender, data);
}

export function getUserExtra(sender, key) {
    const data = getUserData(sender);
    return data[key];
}
