/**
 * ───────────────────────────────────────────────────────────
 *  AI TOOLS — extra capabilities buat Wily AI
 *  Pola sama kayak [GAMBAR:...] di imageSearch.js: AI nulis
 *  marker di response, handler nge-extract & kirim media.
 *
 *  Marker yang didukung:
 *    [VN: teks]                  → voice note bahasa Indonesia
 *    [VN-JP: teks]               → voice note bahasa Jepang (kawaii)
 *    [VN-EN: teks]               → voice note bahasa Inggris
 *    [VN-XX: teks]               → kode bahasa lain (es, fr, ko, zh, dll)
 *    [STIKER: query]             → sticker WhatsApp (search img → webp)
 *    [LAGU: judul lagu]          → audio mp3 dari YouTube
 *    [VIDEO: judul video]        → video mp4 dari YouTube
 *
 *  [GAMBAR:...] tetap di imageSearch.js (legacy).
 * ───────────────────────────────────────────────────────────
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { searchAndGetImage } from './imageSearch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TMP_DIR = path.join(process.cwd(), 'tmp');
const BIN_DIR = path.join(process.cwd(), 'bin');

function ensureTmp() {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

const aiToolsLog = (...args) => {
    if (typeof globalThis.wilyLog === 'function') globalThis.wilyLog(...args);
    else console.log(...args);
};

const aiToolsError = (...args) => {
    if (typeof globalThis.wilyError === 'function') globalThis.wilyError(...args);
    else console.error(...args);
};

// ════════════════════════════════════════════════════════════
//  GOOGLE TTS  (free, no API key — pakai endpoint translate)
// ════════════════════════════════════════════════════════════

const TTS_MAX_CHUNK = 190; // safe limit per request
const TTS_BASE = 'https://translate.google.com/translate_tts';

// Split teks panjang jadi chunk per ~190 char tanpa motong kata.
function chunkText(text, max = TTS_MAX_CHUNK) {
    const chunks = [];
    let remaining = String(text || '').trim();
    while (remaining.length > 0) {
        if (remaining.length <= max) {
            chunks.push(remaining);
            break;
        }
        // Cari titik/koma/spasi sebelum batas max
        let cut = -1;
        for (let i = max; i > Math.floor(max * 0.5); i--) {
            const ch = remaining[i];
            if (ch === '.' || ch === '!' || ch === '?' || ch === ',' || ch === ';' || ch === '\n') {
                cut = i + 1; break;
            }
        }
        if (cut < 0) {
            for (let i = max; i > Math.floor(max * 0.5); i--) {
                if (remaining[i] === ' ') { cut = i; break; }
            }
        }
        if (cut < 0) cut = max;
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
    }
    return chunks.filter(c => c.length > 0);
}

/**
 * Generate voice note dari teks pakai Google TTS (gratis, tanpa API key).
 * @param {string} text - Teks yang diucapkan (max ~3000 karakter total).
 * @param {string} lang - Kode bahasa: 'id' (Indonesia), 'en' (English), dll.
 * @returns {Promise<Buffer>} Buffer mp3.
 */
export async function googleTTS(text, lang = 'id') {
    const cleanText = String(text || '').replace(/[\[\]]/g, '').trim();
    if (!cleanText) throw new Error('Teks TTS kosong');
    if (cleanText.length > 3000) {
        throw new Error('Teks TTS terlalu panjang (max 3000 karakter)');
    }

    const chunks = chunkText(cleanText);
    const buffers = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const params = new URLSearchParams({
            ie: 'UTF-8',
            q: chunk,
            tl: lang,
            client: 'tw-ob',
            ttsspeed: '1',
            total: String(chunks.length),
            idx: String(i),
            textlen: String(chunk.length),
        });

        const url = `${TTS_BASE}?${params.toString()}`;
        try {
            const res = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
                    'Referer': 'https://translate.google.com/',
                    'Accept': 'audio/mpeg, */*',
                    'Accept-Language': lang === 'id' ? 'id-ID,id;q=0.9,en;q=0.8' : 'en-US,en;q=0.9',
                },
            });
            if (!res.data || res.data.length < 100) {
                throw new Error('TTS response kosong/terlalu kecil');
            }
            buffers.push(Buffer.from(res.data));
        } catch (e) {
            const status = e.response?.status;
            throw new Error(`Google TTS gagal (chunk ${i + 1}/${chunks.length}, status ${status || '?'}): ${e.message}`);
        }
    }

    return Buffer.concat(buffers);
}

// ════════════════════════════════════════════════════════════
//  YT-DLP HELPERS  (audio & video download dari YouTube)
// ════════════════════════════════════════════════════════════

function getYtdlpBin() {
    return path.join(BIN_DIR, 'yt-dlp');
}

// Cek aja, asumsi binary udah disiapkan oleh ensureYtdlp() di message.js.
function assertYtdlpReady() {
    const bin = getYtdlpBin();
    if (!fs.existsSync(bin)) {
        throw new Error('yt-dlp binary belum tersedia. Pastikan ensureYtdlp() dipanggil dulu.');
    }
    return bin;
}

function execAsync(cmd, opts = {}) {
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 120000, ...opts }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve({ stdout, stderr });
        });
    });
}

/**
 * Search YouTube + download audio mp3 dalam 1 panggilan.
 * @param {string} query - Judul lagu untuk dicari.
 * @param {object} opts - { maxDuration: 600 (detik), ytdlpBin?: string }
 * @returns {Promise<{buffer: Buffer, title: string, channel: string, duration: number, url: string}>}
 */
export async function searchAndDownloadAudio(query, opts = {}) {
    ensureTmp();
    const maxDuration = opts.maxDuration || 600; // 10 menit
    const ytdlpBin = opts.ytdlpBin || assertYtdlpReady();

    if (!query || !query.trim()) throw new Error('Query lagu kosong');

    // Step 1: Search
    const yts = (await import('yt-search')).default;
    const searchResult = await yts(query.trim());
    const video = searchResult?.videos?.[0];
    if (!video) throw new Error(`Lagu "${query}" tidak ditemukan di YouTube`);
    if (video.seconds > maxDuration) {
        throw new Error(`Durasi terlalu panjang (${video.duration?.timestamp}), max ${Math.floor(maxDuration / 60)} menit`);
    }

    aiToolsLog(`[AITool/LAGU] 🔎 "${query}" → "${video.title}" (${video.duration?.timestamp})`);

    // Step 2: Download via yt-dlp
    const tmpId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const outFile = path.join(TMP_DIR, `ai_audio_${tmpId}.mp3`);
    const outTemplate = path.join(TMP_DIR, `ai_audio_${tmpId}.%(ext)s`);

    const cmd = `"${ytdlpBin}" --js-runtimes node --no-playlist -x --audio-format mp3 --audio-quality 5 -o "${outTemplate}" "${video.url}"`;
    try {
        await execAsync(cmd, { timeout: 120000 });
    } catch (e) {
        try { fs.unlinkSync(outFile); } catch (_) {}
        throw new Error(`Download audio gagal: ${e.message.split('\n')[0]}`);
    }

    if (!fs.existsSync(outFile)) {
        throw new Error('File audio gak ke-generate sama yt-dlp');
    }

    const buffer = fs.readFileSync(outFile);
    try { fs.unlinkSync(outFile); } catch (_) {}

    aiToolsLog(`[AITool/LAGU] ✅ "${video.title}" — ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    return {
        buffer,
        title: video.title,
        channel: video.author?.name || 'Unknown',
        duration: video.seconds,
        url: video.url,
    };
}

/**
 * Search YouTube + download video mp4 (360p, max 3 menit default).
 * @param {string} query
 * @param {object} opts - { maxDuration: 180, ytdlpBin?: string }
 * @returns {Promise<{buffer: Buffer, title: string, channel: string, duration: number, url: string, thumb: string}>}
 */
export async function searchAndDownloadVideo(query, opts = {}) {
    ensureTmp();
    const maxDuration = opts.maxDuration || 180; // 3 menit (video makan bandwidth)
    const ytdlpBin = opts.ytdlpBin || assertYtdlpReady();

    if (!query || !query.trim()) throw new Error('Query video kosong');

    const yts = (await import('yt-search')).default;
    const searchResult = await yts(query.trim());
    const video = searchResult?.videos?.[0];
    if (!video) throw new Error(`Video "${query}" tidak ditemukan di YouTube`);
    if (video.seconds > maxDuration) {
        throw new Error(`Durasi video terlalu panjang (${video.duration?.timestamp}), max ${Math.floor(maxDuration / 60)} menit`);
    }

    aiToolsLog(`[AITool/VIDEO] 🔎 "${query}" → "${video.title}" (${video.duration?.timestamp})`);

    const tmpId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const outFile = path.join(TMP_DIR, `ai_video_${tmpId}.mp4`);
    const outTemplate = path.join(TMP_DIR, `ai_video_${tmpId}.%(ext)s`);

    const cmd = `"${ytdlpBin}" --js-runtimes node --no-playlist ` +
        `-f "bestvideo[height<=360]+bestaudio/best[height<=360]" ` +
        `--merge-output-format mp4 ` +
        `--postprocessor-args "ffmpeg:-c:v libx264 -c:a aac -movflags +faststart -preset fast -crf 28" ` +
        `-o "${outTemplate}" "${video.url}"`;

    try {
        await execAsync(cmd, { timeout: 180000 });
    } catch (e) {
        try { fs.unlinkSync(outFile); } catch (_) {}
        throw new Error(`Download video gagal: ${e.message.split('\n')[0]}`);
    }

    if (!fs.existsSync(outFile)) {
        throw new Error('File video gak ke-generate sama yt-dlp');
    }

    const buffer = fs.readFileSync(outFile);
    try { fs.unlinkSync(outFile); } catch (_) {}

    aiToolsLog(`[AITool/VIDEO] ✅ "${video.title}" — ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    return {
        buffer,
        title: video.title,
        channel: video.author?.name || 'Unknown',
        duration: video.seconds,
        url: video.url,
        thumb: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
    };
}

// ════════════════════════════════════════════════════════════
//  EXTRACTORS  (parse marker dari response AI)
// ════════════════════════════════════════════════════════════

// Mapping kode marker → kode bahasa Google TTS.
// Sengaja flexible: JP/JA → ja, EN/US/GB → en, ID → id, dst.
const VN_LANG_MAP = {
    'ID': 'id', 'IND': 'id', 'IN': 'id',
    'JP': 'ja', 'JA': 'ja', 'JPN': 'ja',
    'EN': 'en', 'US': 'en', 'GB': 'en', 'UK': 'en', 'ENG': 'en',
    'KR': 'ko', 'KO': 'ko', 'KOR': 'ko',
    'CN': 'zh-CN', 'ZH': 'zh-CN', 'CHN': 'zh-CN',
    'TW': 'zh-TW',
    'JV': 'jw', 'SU': 'su',
    'AR': 'ar', 'ARB': 'ar',
    'ES': 'es', 'FR': 'fr', 'DE': 'de', 'IT': 'it',
    'PT': 'pt', 'NL': 'nl', 'RU': 'ru', 'TR': 'tr',
    'TH': 'th', 'VI': 'vi', 'HI': 'hi',
};

function resolveVnLang(code) {
    if (!code) return 'id';
    const upper = String(code).toUpperCase().trim();
    return VN_LANG_MAP[upper] || code.toLowerCase();
}

/**
 * Parse [VN: ...] / [VN-JP: ...] / [VN-EN: ...] dll dari response AI,
 * generate voice note pakai Google TTS sesuai bahasa yang dipilih.
 * @returns {Promise<{cleanText: string, voiceNotes: Array<{buffer, text, lang}>}>}
 */
export async function extractVoiceNotesFromText(text) {
    const voiceNotes = [];
    let cleanText = String(text || '');

    // Group 1: opsional kode bahasa setelah dash (JP, EN, KR, dll)
    // Group 2: isi teks
    const regex = /\[VN(?:-([A-Za-z]{2,4}))?:\s*([^\]]{1,500})\]/gi;
    const matches = [...cleanText.matchAll(regex)];

    for (const match of matches) {
        const fullMarker = match[0];
        const langCode = match[1];
        const vnText = match[2].trim();
        cleanText = cleanText.split(fullMarker).join('');

        if (!vnText) continue;
        const lang = resolveVnLang(langCode);
        try {
            const buffer = await googleTTS(vnText, lang);
            voiceNotes.push({ buffer, text: vnText, lang });
            aiToolsLog(`[AITool/VN] ✅ [${lang}] "${vnText.slice(0, 50)}..." (${(buffer.length / 1024).toFixed(1)} KB)`);
        } catch (e) {
            aiToolsError(`[AITool/VN] ❌ Gagal TTS [${lang}] untuk "${vnText.slice(0, 40)}...": ${e.message}`);
        }
    }

    cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
    return { cleanText, voiceNotes };
}

// ════════════════════════════════════════════════════════════
//  STIKER  (search image → konversi ke webp sticker WhatsApp)
// ════════════════════════════════════════════════════════════

/**
 * Parse [STIKER: query] / [STICKER: query] dari response AI.
 * Cari gambar via imageSearch, lalu konversi ke webp sticker.
 * @param {string} text
 * @param {object} opts - { pack?: string, author?: string }
 * @returns {Promise<{cleanText: string, stickers: Array<{buffer, query}>}>}
 */
export async function extractStickersFromText(text, opts = {}) {
    const stickers = [];
    let cleanText = String(text || '');

    const regex = /\[(?:STIKER|STICKER):\s*([^\]]{1,200})\]/gi;
    const matches = [...cleanText.matchAll(regex)];

    if (matches.length === 0) {
        return { cleanText, stickers };
    }

    let StickerCtor = null;
    let StickerTypesEnum = null;
    try {
        const mod = await import('wa-sticker-formatter');
        StickerCtor = mod.Sticker;
        StickerTypesEnum = mod.StickerTypes;
    } catch (e) {
        aiToolsError(`[AITool/STIKER] ❌ wa-sticker-formatter tidak tersedia: ${e.message}`);
        // Hapus marker biar gak nongol di teks final
        for (const match of matches) {
            cleanText = cleanText.split(match[0]).join('');
        }
        return { cleanText: cleanText.replace(/\n{3,}/g, '\n\n').trim(), stickers };
    }

    const packName = opts.pack || 'Wily Bot AI';
    const authorName = opts.author || 'Bang Wilykun';

    for (const match of matches) {
        const fullMarker = match[0];
        const query = match[1].trim();
        cleanText = cleanText.split(fullMarker).join('');

        if (!query) continue;
        try {
            const found = await searchAndGetImage(query);
            if (!found || !found.buffer) {
                aiToolsError(`[AITool/STIKER] ❌ Gambar tidak ketemu untuk "${query}"`);
                continue;
            }
            const sticker = new StickerCtor(found.buffer, {
                pack: packName,
                author: authorName,
                type: StickerTypesEnum.FULL,
                categories: ['🎭', '✨'],
                id: `wilyai.${Date.now()}`,
                quality: 70,
            });
            const buffer = await sticker.toBuffer();
            stickers.push({ buffer, query, sourceUrl: found.url });
            aiToolsLog(`[AITool/STIKER] ✅ "${query}" → ${(buffer.length / 1024).toFixed(1)} KB webp`);
        } catch (e) {
            aiToolsError(`[AITool/STIKER] ❌ Gagal generate sticker "${query}": ${e.message}`);
        }
    }

    cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
    return { cleanText, stickers };
}

/**
 * Parse [LAGU: ...] dari response AI, search YT + download audio.
 * @param {string} text
 * @param {object} opts - { ytdlpBin: string } — wajib di-pass dari handler
 * @returns {Promise<{cleanText: string, songs: Array}>}
 */
export async function extractSongsFromText(text, opts = {}) {
    const songs = [];
    let cleanText = String(text || '');

    const regex = /\[LAGU:\s*([^\]]{1,200})\]/gi;
    const matches = [...cleanText.matchAll(regex)];

    for (const match of matches) {
        const fullMarker = match[0];
        const query = match[1].trim();
        cleanText = cleanText.split(fullMarker).join('');

        if (!query) continue;
        try {
            const result = await searchAndDownloadAudio(query, opts);
            songs.push({ ...result, query });
        } catch (e) {
            aiToolsError(`[AITool/LAGU] ❌ Gagal cari/download lagu "${query}": ${e.message}`);
        }
    }

    cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
    return { cleanText, songs };
}

/**
 * Parse [VIDEO: ...] dari response AI, search YT + download video mp4.
 * @param {string} text
 * @param {object} opts - { ytdlpBin: string } — wajib di-pass dari handler
 * @returns {Promise<{cleanText: string, videos: Array}>}
 */
export async function extractVideosFromText(text, opts = {}) {
    const videos = [];
    let cleanText = String(text || '');

    const regex = /\[VIDEO:\s*([^\]]{1,200})\]/gi;
    const matches = [...cleanText.matchAll(regex)];

    for (const match of matches) {
        const fullMarker = match[0];
        const query = match[1].trim();
        cleanText = cleanText.split(fullMarker).join('');

        if (!query) continue;
        try {
            const result = await searchAndDownloadVideo(query, opts);
            videos.push({ ...result, query });
        } catch (e) {
            aiToolsError(`[AITool/VIDEO] ❌ Gagal cari/download video "${query}": ${e.message}`);
        }
    }

    cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
    return { cleanText, videos };
}

/**
 * Helper: cek apakah teks mengandung marker yang butuh yt-dlp (LAGU/VIDEO).
 */
export function hasMediaDownloadMarker(text) {
    return /\[LAGU:\s*[^\]]+\]/i.test(text) || /\[VIDEO:\s*[^\]]+\]/i.test(text);
}

/**
 * Helper: cek apakah teks mengandung marker STIKER.
 */
export function hasStickerMarker(text) {
    return /\[(?:STIKER|STICKER):\s*[^\]]+\]/i.test(text);
}
