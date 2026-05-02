'use strict';

/**
 * Shared SQLite connection pool.
 * Satu koneksi per absolute file path — tidak pernah buka dua kali ke file yang sama.
 * Semua modul harus import getSharedDb dari sini, bukan buka Database() sendiri.
 */

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3');

const _pool = new Map(); // absPath → Database instance

function applyPragmas(db) {
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -32000');
    db.pragma('temp_store = memory');
    db.pragma('mmap_size = 268435456');
    db.pragma('foreign_keys = ON');
    db.pragma('wal_autocheckpoint = 100');
}

/**
 * Ambil (atau buat) koneksi ke file DB.
 * Kalau sudah pernah dibuka, kembalikan instance yang sama.
 */
export function getSharedDb(filePath) {
    const abs = path.resolve(filePath);
    if (_pool.has(abs)) return _pool.get(abs);

    const dir = path.dirname(abs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const db = new Database(abs);
    applyPragmas(db);

    // Bersihkan WAL lama yang menumpuk (blocking checkpoint + truncate)
    try {
        const result = db.pragma('wal_checkpoint(TRUNCATE)');
        const moved = result?.[0]?.log ?? '?';
        const done  = result?.[0]?.checkpointed ?? '?';
        if (moved !== '?' && Number(moved) > 0) {
            console.log(`\x1b[32m[DBPool]\x1b[39m WAL checkpoint ${path.basename(abs)}: ${done}/${moved} pages`);
        }
    } catch {}

    _pool.set(abs, db);
    return db;
}

/**
 * Tutup koneksi dan hapus dari pool.
 * Hanya panggil ini saat session benar-benar dihapus (mis. logout).
 */
export function releaseDb(filePath) {
    const abs = path.resolve(filePath);
    const db  = _pool.get(abs);
    if (!db) return;
    _pool.delete(abs);
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
    try { db.close(); } catch {}
}

/**
 * Jalankan WAL checkpoint TRUNCATE pada semua DB yang terbuka.
 * Panggil ini dari heartbeat interval untuk jaga WAL tetap kecil.
 */
export function checkpointAll() {
    for (const [absPath, db] of _pool.entries()) {
        try {
            db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (e) {
            console.warn(`\x1b[33m[DBPool]\x1b[39m Checkpoint gagal ${path.basename(absPath)}: ${e.message}`);
        }
    }
}
