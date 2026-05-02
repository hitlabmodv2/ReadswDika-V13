'use strict';

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3');

/* ── Singleton per file path ── */
const _dbCache = new Map();

function getSharedDb(dbPath) {
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
        CREATE TABLE IF NOT EXISTS store (
            collection  TEXT NOT NULL,
            key         TEXT NOT NULL,
            value       TEXT,
            updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            PRIMARY KEY (collection, key)
        );
        CREATE INDEX IF NOT EXISTS idx_store_collection ON store (collection);
    `);

    _dbCache.set(abs, db);
    return db;
}

export class SQLiteDB {
    #db = null;
    #collection = '';
    #cache = {};
    #hasLoaded = false;
    #stmtGet;
    #stmtAll;
    #stmtUpsert;
    #stmtDelete;

    constructor(fileName, dir = null) {
        if (!dir) throw new Error('Directory path must be specified');

        this.#collection = fileName;

        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const dbPath   = path.join(dir, 'auth.db');
        this.#db       = getSharedDb(dbPath);

        this.#stmtGet    = this.#db.prepare('SELECT value FROM store WHERE collection = ? AND key = ?');
        this.#stmtAll    = this.#db.prepare('SELECT key, value FROM store WHERE collection = ?');
        this.#stmtUpsert = this.#db.prepare(`
            INSERT INTO store (collection, key, value, updated_at) VALUES (?, ?, ?, strftime('%s','now'))
            ON CONFLICT(collection, key) DO UPDATE
                SET value = excluded.value, updated_at = excluded.updated_at
        `);
        this.#stmtDelete = this.#db.prepare('DELETE FROM store WHERE collection = ? AND key = ?');

        this.#migrateFromJSON(dir, fileName);
    }

    #migrateFromJSON(dir, fileName) {
        const jsonPath = path.join(dir, fileName + '.json');
        if (!fs.existsSync(jsonPath)) return;

        try {
            const raw = fs.readFileSync(jsonPath, 'utf-8').trim();
            if (!raw || raw === '{}') return;

            const data = JSON.parse(raw);
            const entries = Object.entries(data);
            if (entries.length === 0) return;

            const existing = this.#db.prepare('SELECT COUNT(*) as c FROM store WHERE collection = ?').get(this.#collection);
            if (existing.c > 0) return;

            this.#db.transaction((items) => {
                for (const [k, v] of items) {
                    this.#stmtUpsert.run(this.#collection, k, JSON.stringify(v));
                }
            })(entries);

            console.log(`\x1b[32m[SQLiteDB]\x1b[39m Migrasi ${entries.length} entri dari ${fileName}.json → auth.db`);
        } catch (err) {
            console.error(`\x1b[31m[SQLiteDB]\x1b[39m Gagal migrasi ${fileName}.json:`, err.message);
        }
    }

    #loadCache() {
        if (this.#hasLoaded) return;
        const rows = this.#stmtAll.all(this.#collection);
        this.#cache = {};
        for (const row of rows) {
            try { this.#cache[row.key] = JSON.parse(row.value); } catch { this.#cache[row.key] = row.value; }
        }
        this.#hasLoaded = true;
    }

    load()         { this.#loadCache(); }
    loadIfNeeded() { if (!this.#hasLoaded) this.#loadCache(); }

    exists(key) {
        this.loadIfNeeded();
        return Object.prototype.hasOwnProperty.call(this.#cache, key);
    }

    read(key) {
        this.loadIfNeeded();
        if (!this.exists(key)) return null;
        return this.#cache[key];
    }

    write(key, value) {
        this.loadIfNeeded();
        this.#cache[key] = value;
        this.#stmtUpsert.run(this.#collection, key, JSON.stringify(value));
        return value;
    }

    delete(key) {
        this.loadIfNeeded();
        delete this.#cache[key];
        this.#stmtDelete.run(this.#collection, key);
    }

    keys()    { this.loadIfNeeded(); return Object.keys(this.#cache); }
    values()  { this.loadIfNeeded(); return Object.values(this.#cache); }
    entries() { this.loadIfNeeded(); return Object.entries(this.#cache); }

    find(predicate) {
        this.loadIfNeeded();
        return this.values().find(predicate);
    }
}

export default SQLiteDB;
