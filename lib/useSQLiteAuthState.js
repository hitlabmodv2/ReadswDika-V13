// ═══════════════════════════════════════════════════════════════════════════
//  FILE: lib/useSQLiteAuthState.js
//  Fungsi pengganti useMultiFileAuthState dari Baileys/Socketon
//  Menyimpan session ke 1 file SQLite (auth.db) bukan banyak file terpisah
//
//  Cara pakai:
//    import { useSQLiteAuthState } from './lib/useSQLiteAuthState.js'
//    const { state, saveCreds } = useSQLiteAuthState('./sessions/hisoka/auth.db')
//
//  Referensi: https://github.com/WiseLibs/better-sqlite3
// ═══════════════════════════════════════════════════════════════════════════

import { createRequire } from 'module';
import { getSharedDb, releaseDb } from './dbPool.js';

const _require = createRequire(import.meta.url);
const { initAuthCreds, BufferJSON, makeCacheableSignalKeyStore } = _require('socketon');

/**
 * Bersihkan keys yang sudah expired/stale dari DB.
 * Pre-key & session key yang sudah > 30 hari tidak dipakai dihapus.
 */
function pruneStaleKeys(db) {
    try {
        // Ambil semua kategori keys beserta jumlahnya
        const countBefore = db.prepare('SELECT COUNT(*) as c FROM keys').get().c;
        if (countBefore === 0) return;

        // Cutoff: 30 hari lalu dalam unix seconds
        const cutoffSec = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

        // Hapus pre-key & session key yang updated_at-nya lebih dari 30 hari
        const del = db.transaction(() => {
            const a = db.prepare(
                "DELETE FROM keys WHERE category IN ('pre-key','session','sender-key','sender-key-memory') AND updated_at < ?"
            ).run(cutoffSec);
            return a.changes;
        });

        const deleted = del();
        if (deleted > 0) {
            console.log(`\x1b[32m[AuthDB]\x1b[39m Pruned ${deleted} stale session keys`);
        }
    } catch {}
}

/**
 * Simpan session Baileys/Socketon ke SQLite
 * @param {string} dbPath  - Path ke file auth.db
 * @param {object} logger  - Logger opsional (bisa pakai pino)
 * @returns {{ state, saveCreds, clearSession, closeDatabase, getStats }}
 */
export function useSQLiteAuthState(dbPath = './sessions/auth.db', logger = null) {

    // ── 1. Ambil koneksi dari shared pool (tidak pernah buka dua kali) ───────
    const db = getSharedDb(dbPath);

    // ── 2. Buat tabel jika belum ada (idempotent) ─────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS creds (
            id          INTEGER PRIMARY KEY CHECK (id = 1),
            data        TEXT    NOT NULL,
            updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS keys (
            category    TEXT NOT NULL,
            id          TEXT NOT NULL,
            data        TEXT,
            updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY (category, id)
        );

        CREATE INDEX IF NOT EXISTS idx_keys_category ON keys (category);
    `);

    // ── 3. Bersihkan stale keys sekali saat init ──────────────────────────────
    pruneStaleKeys(db);

    // ── 4. Prepared statements (dibuat SEKALI, di-reuse selamanya) ────────────
    const stmtGetCreds  = db.prepare('SELECT data FROM creds WHERE id = 1');

    const stmtSaveCreds = db.prepare(`
        INSERT INTO creds (id, data, updated_at) VALUES (1, ?, strftime('%s', 'now'))
        ON CONFLICT(id) DO UPDATE
            SET data       = excluded.data,
                updated_at = excluded.updated_at
    `);

    const stmtGetKey = db.prepare(
        'SELECT data FROM keys WHERE category = ? AND id = ?'
    );

    // Cache prepared statements untuk batch GET berdasarkan jumlah ID
    const _batchGetCache = new Map();
    function getBatchStmt(count) {
        if (_batchGetCache.has(count)) return _batchGetCache.get(count);
        const ph   = Array(count).fill('?').join(',');
        const stmt = db.prepare(`SELECT id, data FROM keys WHERE category = ? AND id IN (${ph})`);
        _batchGetCache.set(count, stmt);
        return stmt;
    }

    const stmtUpsertKey = db.prepare(`
        INSERT INTO keys (category, id, data, updated_at)
            VALUES (?, ?, ?, strftime('%s', 'now'))
        ON CONFLICT(category, id) DO UPDATE
            SET data       = excluded.data,
                updated_at = excluded.updated_at
    `);

    const stmtDeleteKey = db.prepare(
        'DELETE FROM keys WHERE category = ? AND id = ?'
    );

    // ── 5. Helper encode/decode dengan BufferJSON ─────────────────────────────
    const serialize   = (val) => JSON.stringify(val, BufferJSON.replacer);
    const deserialize = (raw) => JSON.parse(raw,  BufferJSON.reviver);

    // ── 6. Baca credentials ───────────────────────────────────────────────────
    const readCreds = () => {
        const row = stmtGetCreds.get();
        if (!row?.data) {
            if (logger) logger.info('[AuthState] credentials kosong, buat baru');
            return initAuthCreds();
        }
        return deserialize(row.data);
    };

    // ── 7. Pre-compile transaction untuk batch key writes ─────────────────────
    const keysTransaction = db.transaction((entries) => {
        for (const [category, items] of entries) {
            for (const [id, value] of items) {
                if (value != null) {
                    stmtUpsertKey.run(category, id, serialize(value));
                } else {
                    stmtDeleteKey.run(category, id);
                }
            }
        }
    });

    // ── 8. Buat auth state ────────────────────────────────────────────────────
    const state = {
        creds: readCreds(),

        keys: makeCacheableSignalKeyStore(
            {
                // Batch GET: 1 query untuk banyak ID (jauh lebih cepat dari N query individual)
                get(type, ids) {
                    if (!ids || ids.length === 0) return {};
                    const result = {};
                    if (ids.length === 1) {
                        // Fast path: satu ID, pakai prepared statement biasa
                        const row = stmtGetKey.get(type, ids[0]);
                        if (row?.data) result[ids[0]] = deserialize(row.data);
                        return result;
                    }
                    // Batch path: IN (...) query untuk banyak ID sekaligus
                    const rows = getBatchStmt(ids.length).all(type, ...ids);
                    for (const row of rows) {
                        if (row?.data) result[row.id] = deserialize(row.data);
                    }
                    return result;
                },

                // Batch SET: satu transaction untuk semua perubahan
                set(data) {
                    const entries = Object.entries(data).map(
                        ([cat, items]) => [cat, Object.entries(items || {})]
                    );
                    if (entries.length > 0) keysTransaction(entries);
                },
            },
            logger
        ),
    };

    // ── 9. saveCreds ──────────────────────────────────────────────────────────
    const saveCreds = () => {
        db.prepare(`
            INSERT INTO creds (id, data, updated_at) VALUES (1, ?, strftime('%s', 'now'))
            ON CONFLICT(id) DO UPDATE
                SET data       = excluded.data,
                    updated_at = excluded.updated_at
        `).run(serialize(state.creds));
    };

    // ── 10. Utilitas ──────────────────────────────────────────────────────────
    const clearSession = () => {
        db.exec('DELETE FROM creds; DELETE FROM keys;');
    };

    const closeDatabase = () => {
        releaseDb(dbPath);
    };

    const getStats = () => {
        const credsCount = db.prepare('SELECT COUNT(*) as c FROM creds').get().c;
        const keysCount  = db.prepare('SELECT COUNT(*) as c FROM keys').get().c;
        const keysByType = db.prepare(
            'SELECT category, COUNT(*) as c FROM keys GROUP BY category ORDER BY c DESC'
        ).all();
        const walInfo = (() => {
            try { return db.pragma('wal_checkpoint(PASSIVE)'); } catch { return null; }
        })();
        return {
            hasCreds:  credsCount > 0,
            totalKeys: keysCount,
            keysByType,
            wal: walInfo?.[0] ?? null,
        };
    };

    return { state, saveCreds, clearSession, closeDatabase, getStats };
}
