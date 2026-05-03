'use strict';

/**
 * Shared SQLite connection pool.
 * Satu koneksi per absolute file path — tidak pernah buka dua kali ke file yang sama.
 * Semua modul harus import getSharedDb dari sini, bukan buka Database() sendiri.
 *
 * Referensi: https://github.com/WiseLibs/better-sqlite3
 */

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3');

const _pool = new Map(); // absPath → Database instance
let   _shutdownRegistered = false;

function applyPragmas(db) {
    // WAL mode: tulis cepat, aman dari korupsi saat crash
    db.pragma('journal_mode = WAL');
    // Tunggu max 5 detik kalau DB sedang dikunci sebelum throw error
    db.pragma('busy_timeout = 5000');
    // NORMAL = aman + cepat di WAL mode
    db.pragma('synchronous = NORMAL');
    // 32MB page cache di memori
    db.pragma('cache_size = -32000');
    // Tabel temp sepenuhnya di RAM
    db.pragma('temp_store = memory');
    // 256MB mmap untuk akses DB langsung via memory-mapped I/O
    db.pragma('mmap_size = 268435456');
    // Foreign key enforcement
    db.pragma('foreign_keys = ON');
    // Auto-checkpoint setiap 1000 page (biarkan default, kita handle manual juga)
    db.pragma('wal_autocheckpoint = 1000');
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

    // PASSIVE checkpoint: tidak blocking, bersihkan WAL frame yang sudah bisa diapply.
    // Lebih cepat dari TRUNCATE karena tidak tunggu reader selesai.
    try { db.pragma('wal_checkpoint(PASSIVE)'); } catch {}

    _pool.set(abs, db);
    _registerShutdownHandlers();
    return db;
}

/**
 * Tutup koneksi dan hapus dari pool.
 * Panggil saat session dihapus/logout.
 */
export function releaseDb(filePath) {
    const abs = path.resolve(filePath);
    const db  = _pool.get(abs);
    if (!db) return;
    _pool.delete(abs);
    _closeDb(abs, db);
}

/**
 * WAL checkpoint TRUNCATE pada semua DB yang terbuka.
 * Panggil dari heartbeat interval untuk jaga WAL tetap kecil.
 */
export function checkpointAll() {
    for (const [absPath, db] of _pool.entries()) {
        try {
            const result = db.pragma('wal_checkpoint(TRUNCATE)');
            const log   = result?.[0]?.log ?? 0;
            const done  = result?.[0]?.checkpointed ?? 0;
            if (log > 0) {
                console.log(`\x1b[32m[DBPool]\x1b[39m WAL ${path.basename(absPath)}: ${done}/${log} pages checkpointed`);
            }
        } catch (e) {
            console.warn(`\x1b[33m[DBPool]\x1b[39m Checkpoint gagal ${path.basename(absPath)}: ${e.message}`);
        }
    }
}

/**
 * Graceful shutdown: checkpoint + optimize + close semua DB.
 * Dipanggil saat SIGTERM / SIGINT / exit.
 */
function _shutdown(signal) {
    for (const [absPath, db] of _pool.entries()) {
        _closeDb(absPath, db);
    }
    _pool.clear();
}

function _closeDb(absPath, db) {
    try {
        // Optimize query planner stats dulu (cepat, non-blocking)
        db.pragma('optimize');
        // Checkpoint + truncate WAL supaya startup berikutnya cepat
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.close();
    } catch {}
}

function _registerShutdownHandlers() {
    if (_shutdownRegistered) return;
    _shutdownRegistered = true;
    // process.on('exit') = selalu dipanggil synchronous sebelum proses benar-benar mati.
    // SIGTERM/SIGINT dihandle di index.js yang memanggil checkpointAll() + process.exit(0),
    // sehingga 'exit' event ini selalu terpanggil dan tidak ada konflik listener.
    process.on('exit', () => _shutdown('exit'));
}
