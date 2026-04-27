/**
 * ───────────────────────────────────────────────────────────
 *  AI TOOLS — extra capabilities buat Wily AI
 *  Pola sama kayak [GAMBAR:...] di imageSearch.js: AI nulis
 *  marker di response, handler nge-extract & kirim media.
 *
 *  Marker yang didukung:
 *    [VN: teks yang diucapkan]   → voice note pakai Google TTS
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

/**
 * Parse [VN: ...] dari response AI, generate voice note pakai Google TTS.
 * @returns {Promise<{cleanText: string, voiceNotes: Array<{buffer, text}>}>}
 */
export async function extractVoiceNotesFromText(text) {
    const voiceNotes = [];
    let cleanText = String(text || '');

    const regex = /\[VN:\s*([^\]]{1,500})\]/gi;
    const matches = [...cleanText.matchAll(regex)];

    for (const match of matches) {
        const fullMarker = match[0];
        const vnText = match[1].trim();
        cleanText = cleanText.split(fullMarker).join('');

        if (!vnText) continue;
        try {
            const buffer = await googleTTS(vnText, 'id');
            voiceNotes.push({ buffer, text: vnText });
            aiToolsLog(`[AITool/VN] ✅ "${vnText.slice(0, 50)}..." (${(buffer.length / 1024).toFixed(1)} KB)`);
        } catch (e) {
            aiToolsError(`[AITool/VN] ❌ Gagal TTS untuk "${vnText.slice(0, 40)}...": ${e.message}`);
        }
    }

    cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
    return { cleanText, voiceNotes };
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
