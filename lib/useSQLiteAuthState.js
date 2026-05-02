// ═══════════════════════════════════════════════════════════════════════════
//  FILE: lib/useSQLiteAuthState.js
//  Fungsi pengganti useMultiFileAuthState dari Baileys/Socketon
//  Menyimpan session ke 1 file SQLite (auth.db) bukan banyak file terpisah
//
//  Cara pakai:
//    import { useSQLiteAuthState } from './lib/useSQLiteAuthState.js'
//    const { state, saveCreds } = useSQLiteAuthState('./sessions/hisoka/auth.db')
// ═══════════════════════════════════════════════════════════════════════════

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3');
const { initAuthCreds, BufferJSON, makeCacheableSignalKeyStore } = _require('socketon');

/* ── Singleton: satu koneksi per file auth.db ── */
const _dbCache = new Map();

function getAuthDb(dbPath) {
    const abs = path.resolve(dbPath);
    if (_dbCache.has(abs)) return _dbCache.get(abs);

    const db = new Database(abs);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -16000');
    db.pragma('temp_store = memory');
    db.pragma('mmap_size = 268435456');
    db.pragma('foreign_keys = ON');
    db.pragma('wal_autocheckpoint = 100');

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

    _dbCache.set(abs, db);
    return db;
}

/**
 * Simpan session Baileys/Socketon ke SQLite
 * @param {string} dbPath  - Path ke file auth.db  (default: ./sessions/auth.db)
 * @param {object} logger  - Logger opsional (bisa pakai pino)
 * @returns {{ state, saveCreds, clearSession, closeDatabase, getStats }}
 */
export function useSQLiteAuthState(dbPath = './sessions/auth.db', logger = null) {

    // ── 1. Pastikan folder sessions ada ─────────────────────────────────────
    const folder = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    // ── 2. Buka / ambil koneksi singleton ────────────────────────────────────
    const db = getAuthDb(dbPath);

    // ── 3. Prepared statements (reuse per koneksi) ───────────────────────────
    const stmtGetCreds  = db.prepare('SELECT data FROM creds WHERE id = 1');

    const stmtSaveCreds = db.prepare(`
        INSERT INTO creds (id, data, updated_at) VALUES (1, ?, strftime('%s', 'now'))
        ON CONFLICT(id) DO UPDATE
            SET data       = excluded.data,
                updated_at = excluded.updated_at
    `);

    const stmtGetKey    = db.prepare(
        'SELECT data FROM keys WHERE category = ? AND id = ?'
    );

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

    // ── 4. Helper encode/decode JSON dengan BufferJSON ───────────────────────
    const serialize   = (data) => JSON.stringify(data, BufferJSON.replacer);
    const deserialize = (raw)  => JSON.parse(raw, BufferJSON.reviver);

    // ── 5. Baca credentials (atau buat baru kalau kosong) ────────────────────
    const readCreds = () => {
        const row = stmtGetCreds.get();
        if (!row?.data) {
            if (logger) logger.info('useSQLiteAuthState: credentials kosong, buat baru');
            return initAuthCreds();
        }
        return deserialize(row.data);
    };

    // ── 6. Tulis credentials ─────────────────────────────────────────────────
    const writeCreds = (creds) => {
        stmtSaveCreds.run(serialize(creds));
    };

    // ── 7. Buat auth state ───────────────────────────────────────────────────
    const keysTransaction = db.transaction((data) => {
        for (const [category, entries] of Object.entries(data)) {
            for (const [id, value] of Object.entries(entries || {})) {
                if (value != null) {
                    stmtUpsertKey.run(category, id, serialize(value));
                } else {
                    stmtDeleteKey.run(category, id);
                }
            }
        }
    });

    const state = {
        creds: readCreds(),

        keys: makeCacheableSignalKeyStore(
            {
                get(type, ids) {
                    const result = {};
                    for (const id of ids) {
                        const row = stmtGetKey.get(type, id);
                        if (row?.data) result[id] = deserialize(row.data);
                    }
                    return result;
                },

                set(data) {
                    keysTransaction(data);
                },
            },
            logger
        ),
    };

    // ── 8. Fungsi saveCreds ───────────────────────────────────────────────────
    const saveCreds = () => {
        writeCreds(state.creds);
    };

    // ── 9. Fungsi utilitas tambahan ──────────────────────────────────────────
    const clearSession = () => {
        db.exec('DELETE FROM creds; DELETE FROM keys;');
    };

    const closeDatabase = () => {
        const abs = path.resolve(dbPath);
        _dbCache.delete(abs);
        db.close();
    };

    const getStats = () => {
        const credsCount = db.prepare('SELECT COUNT(*) as c FROM creds').get().c;
        const keysCount  = db.prepare('SELECT COUNT(*) as c FROM keys').get().c;
        const keysByType = db.prepare(
            'SELECT category, COUNT(*) as c FROM keys GROUP BY category ORDER BY c DESC'
        ).all();
        return { hasCreds: credsCount > 0, totalKeys: keysCount, keysByType };
    };

    return {
        state,
        saveCreds,
        clearSession,
        closeDatabase,
        getStats,
    };
}
