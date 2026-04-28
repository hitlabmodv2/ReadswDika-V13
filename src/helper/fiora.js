/**
 * src/helper/fiora.js
 * Adapter: port logika Fiora AI (Nixel) ke wily-bot.
 *
 * Public API:
 *   runFiora(hisoka, m, input, { groupMetadata })
 *
 * - Pakai gemini.js (token pool wily-bot) sebagai backend AI
 * - History per-chat disimpan in-memory (Map)
 * - Konversi audio (SPEECH) lewat fluent-ffmpeg
 * - Office-to-PDF di-stub (tidak didukung)
 */

import axios from 'axios';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import fileType from 'file-type';
const fileTypeFromBuffer = fileType.fromBuffer || fileType.fileTypeFromBuffer || (async () => null);
import { PassThrough } from 'stream';
import ffmpeg from 'fluent-ffmpeg';
import { createRequire } from 'module';

import gemini from './gemini.js';
import Button from '../lib/Button.js';
import { ornzora } from '../lib/uploader.js';
import {
  pins,
  SpotDown,
  youtubeSearch,
  lyricsSearch,
  googleSearch,
  aiorapidapi,
  gptimage,
  AIBanana,
  getBuffer,
  webpToJpg,
  imagy,
  reelsSearch,
} from '../lib/tools.js';

const _require = createRequire(import.meta.url);
const {
  generateMessageIDV2,
  prepareWAMessageMedia,
  generateWAMessage,
  jidNormalizedUser,
  getContentType,
  downloadMediaMessage,
} = _require('socketon');

// ────────────────────────────────────────────────
// Globals (Fiora pakai global.namebot/global.author)
// ────────────────────────────────────────────────
if (!global.namebot) global.namebot = 'Wily Bot';
if (!global.author) global.author = 'WilyKun';

// ────────────────────────────────────────────────
// In-memory history per-chat (pengganti global.db.data.msgs[chat].fioradb)
// ────────────────────────────────────────────────
const HISTORY = new Map();             // chatJid -> [{ role, parts, userJid, timestamp }]
const HISTORY_LIMIT_PER_CHAT = 200;
const DEBUG_USERS = new Set();         // user yang nyalain debug

function getChatHistory(chatJid) {
  if (!HISTORY.has(chatJid)) HISTORY.set(chatJid, []);
  return HISTORY.get(chatJid);
}

export function clearFioraHistory(chatJid) {
  if (chatJid) HISTORY.delete(chatJid);
  else HISTORY.clear();
}

// ────────────────────────────────────────────────
// Util waktu / format / id / emoji
// ────────────────────────────────────────────────
function getRandomEmoji() {
  const emoji = [
    '\u2764\uFE0F\u200D\uD83D\uDD25', '\uD83D\uDC95', '\uD83D\uDC97',
    '\uD83D\uDC96', '\u2764\uFE0F', '\uD83E\uDDE1', '\uD83D\uDC9B',
    '\uD83D\uDC9A', '\uD83D\uDC99', '\uD83D\uDC9C', '\uD83E\uDD17',
    '\uD83E\uDD7A', '\uD83E\uDD14', '\uD83E\uDD24', '\uD83D\uDE36\u200D\uD83C\uDF2B\uFE0F',
  ];
  return emoji[Math.floor(Math.random() * emoji.length)];
}

function formatMs(ms) {
  let sec = (ms / 1000).toFixed(1).replace('.', ',');
  return sec.endsWith(',0') ? sec.slice(0, -2) : sec;
}

function generateFioraID() {
  return 'FIORA' + generateMessageIDV2().slice(5);
}

function getWIBDateTime() {
  const now = new Date();
  const wibOffset = 7 * 60;
  const localOffset = now.getTimezoneOffset();
  const diff = (wibOffset + localOffset) * 60 * 1000;
  const wibTime = new Date(now.getTime() + diff);

  const hariList = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const bulanList = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  const pad = (n) => String(n).padStart(2, '0');

  return {
    hari: hariList[wibTime.getDay()],
    tanggal: wibTime.getDate(),
    bulan: bulanList[wibTime.getMonth()],
    tahun: wibTime.getFullYear(),
    jam: `${pad(wibTime.getHours())}:${pad(wibTime.getMinutes())}:${pad(wibTime.getSeconds())}`,
    jamSaja: pad(wibTime.getHours()),
    menit: pad(wibTime.getMinutes()),
    detik: pad(wibTime.getSeconds()),
    timezone: 'WIB',
  };
}

// ────────────────────────────────────────────────
// Conn facade (wrap hisoka, tambah method yang Fiora butuhkan)
// ────────────────────────────────────────────────
function makeConn(hisoka) {
  const conn = hisoka;

  // decodeJid: normalize JID (s.whatsapp.net / lid / g.us)
  if (typeof conn.decodeJid !== 'function') {
    conn.decodeJid = (jid) => {
      if (!jid) return jid;
      try { return jidNormalizedUser(jid); } catch { return jid; }
    };
  }

  // parseMention: ekstrak nomor dari teks (@628xxx → 628xxx@s.whatsapp.net)
  if (typeof conn.parseMention !== 'function') {
    conn.parseMention = (text = '') => {
      const out = [];
      const re = /@(\d{5,16})/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        out.push(m[1] + '@s.whatsapp.net');
      }
      return out;
    };
  }

  // getJid: convert apa-pun ke "xxx@s.whatsapp.net"
  if (typeof conn.getJid !== 'function') {
    conn.getJid = (input) => {
      if (!input) return input;
      const s = String(input);
      if (s.includes('@')) return jidNormalizedUser(s);
      return s.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    };
  }

  // getFile: download URL/buffer → { data, mime, ext }
  if (typeof conn.getFile !== 'function') {
    conn.getFile = async (source) => {
      let buffer;
      if (Buffer.isBuffer(source)) buffer = source;
      else if (typeof source === 'string') {
        if (/^https?:\/\//i.test(source)) {
          const res = await axios.get(source, { responseType: 'arraybuffer', timeout: 30000 });
          buffer = Buffer.from(res.data);
        } else {
          throw new Error('getFile: input bukan URL atau buffer');
        }
      } else {
        throw new Error('getFile: tipe input tidak dikenal');
      }
      const ft = await fileTypeFromBuffer(buffer).catch(() => null);
      return {
        data: buffer,
        mime: ft?.mime || 'application/octet-stream',
        ext: ft?.ext || 'bin',
      };
    };
  }

  // sendContact: kirim vcard
  if (typeof conn.sendContact !== 'function') {
    conn.sendContact = async (jid, contacts, quoted, opts = {}) => {
      const list = (Array.isArray(contacts) ? contacts : [contacts]).map(c => {
        const [number, name] = Array.isArray(c) ? c : [c.number, c.name];
        const num = String(number).replace(/[^0-9]/g, '');
        return {
          displayName: name || num,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${name || num}\nTEL;type=CELL;waid=${num}:+${num}\nEND:VCARD`,
        };
      });
      const content = list.length === 1
        ? { contacts: { displayName: list[0].displayName, contacts: list } }
        : { contacts: { displayName: `${list.length} contacts`, contacts: list } };
      return await conn.sendMessage(jid, content, { quoted, ...opts });
    };
  }

  // sendSticker: kirim sticker dari buffer/url
  if (typeof conn.sendSticker !== 'function') {
    conn.sendSticker = async (jid, source, quoted, opts = {}) => {
      let buffer;
      if (Buffer.isBuffer(source)) buffer = source;
      else if (typeof source === 'string') {
        const res = await axios.get(source, { responseType: 'arraybuffer', timeout: 30000 });
        buffer = Buffer.from(res.data);
      }
      return await conn.sendMessage(jid, { sticker: buffer }, { quoted, ...opts });
    };
  }

  return conn;
}

// ────────────────────────────────────────────────
// Message facade (wrap m supaya punya field/method yg Fiora butuhkan)
// ────────────────────────────────────────────────
function makeM(hisoka, m) {
  // wily-bot udah kasih banyak field — tinggal nambahin yang kurang
  const wrapped = m;

  if (!wrapped.id && wrapped.key?.id) wrapped.id = wrapped.key.id;
  if (!wrapped.chat) wrapped.chat = wrapped.from;
  if (!wrapped.mtype) wrapped.mtype = wrapped.type || (wrapped.message ? getContentType(wrapped.message) : '');
  if (typeof wrapped.text !== 'string') {
    wrapped.text = wrapped.body
      || wrapped.message?.conversation
      || wrapped.message?.extendedTextMessage?.text
      || '';
  }

  // react
  if (typeof wrapped.react !== 'function') {
    wrapped.react = async (emoji) => {
      try {
        return await hisoka.sendMessage(wrapped.from, { react: { text: emoji || '', key: wrapped.key } });
      } catch (_) { /* ignore */ }
    };
  }

  // reply (wily-bot udah punya, tapi kalau gak ada fallback)
  if (typeof wrapped.reply !== 'function') {
    wrapped.reply = async (text, opts = {}) => {
      return await hisoka.sendMessage(wrapped.from, { text: String(text), ...opts }, { quoted: wrapped });
    };
  }

  // edit (Baileys: { text, edit: key })
  if (typeof wrapped.edit !== 'function') {
    wrapped.edit = async (text, key) => {
      try {
        return await hisoka.sendMessage(wrapped.from, { text: String(text), edit: key || wrapped.key });
      } catch (_) { /* ignore */ }
    };
  }

  // download (alias ke downloadMedia kalau ada)
  if (typeof wrapped.download !== 'function') {
    wrapped.download = async () => {
      if (typeof wrapped.downloadMedia === 'function') return await wrapped.downloadMedia();
      if (typeof hisoka.downloadMediaMessage === 'function') return await hisoka.downloadMediaMessage(wrapped);
      try {
        return await downloadMediaMessage(wrapped, 'buffer', {}, { logger: hisoka.logger, reuploadRequest: hisoka.updateMediaMessage });
      } catch { return null; }
    };
  }

  // wrap quoted juga
  if (wrapped.quoted && wrapped.isQuoted) {
    const q = wrapped.quoted;
    if (!q.id && q.key?.id) q.id = q.key.id;
    if (!q.chat) q.chat = q.from || wrapped.from;
    if (!q.mtype) q.mtype = q.type || (q.raw ? getContentType(q.raw) : '');
    if (typeof q.text !== 'string') {
      q.text = q.body
        || q.raw?.conversation
        || q.raw?.extendedTextMessage?.text
        || '';
    }
    if (typeof q.download !== 'function') {
      q.download = async () => {
        if (typeof q.downloadMedia === 'function') return await q.downloadMedia();
        const fake = { ...q, message: q.raw || q.message };
        try { return await downloadMediaMessage(fake, 'buffer', {}, { logger: hisoka.logger, reuploadRequest: hisoka.updateMediaMessage }); }
        catch { return null; }
      };
    }
    if (!q.message && q.raw) q.message = q.raw;
  }

  return wrapped;
}

// ────────────────────────────────────────────────
// toPTT: convert audio buffer ke opus PTT (pakai ffmpeg, ganti lib/converter.js)
// ────────────────────────────────────────────────
async function toPTT(buffer) {
  return new Promise((resolve, reject) => {
    const inStream = new PassThrough();
    inStream.end(buffer);
    const chunks = [];
    ffmpeg(inStream)
      .audioChannels(1)
      .audioFrequency(48000)
      .audioCodec('libopus')
      .audioBitrate('64k')
      .format('ogg')
      .on('error', reject)
      .pipe()
      .on('data', c => chunks.push(c))
      .on('end', () => resolve({ data: Buffer.concat(chunks) }));
  });
}

// ────────────────────────────────────────────────
// getWaveForm
// ────────────────────────────────────────────────
async function getWaveForm(buffer, samples = 100) {
  return new Promise((resolve, reject) => {
    const inStream = new PassThrough();
    inStream.end(buffer);
    const chunks = [];
    ffmpeg(inStream)
      .format('f32le')
      .audioChannels(1)
      .on('error', reject)
      .pipe()
      .on('data', c => chunks.push(c))
      .on('end', () => {
        const full = Buffer.concat(chunks);
        const floats = new Float32Array(full.buffer, full.byteOffset, full.byteLength / 4);
        const blockSize = Math.floor(floats.length / samples);
        const wf = new Uint8Array(samples);
        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) sum += Math.abs(floats[i * blockSize + j]);
          let avg = sum / blockSize;
          if (avg > 1) avg = 1;
          let v = avg * 3;
          if (v > 1) v = 1;
          wf[i] = Math.round(v * 255);
        }
        resolve(Buffer.from(wf).toString('base64'));
      });
  });
}

// ────────────────────────────────────────────────
// tokenizer (untuk RICH_RESPONSE code block)
// ────────────────────────────────────────────────
function tokenizer(code, lang = 'javascript') {
  const keywordsMap = {
    javascript: new Set(['break','case','catch','continue','debugger','delete','do','else','finally','for','function','if','in','instanceof','new','return','switch','this','throw','try','typeof','var','void','while','with','true','false','null','undefined','class','const','let','super','extends','export','import','yield','static','constructor','async','await','get','set']),
    python: new Set(['def','return','if','elif','else','for','while','class','try','except','finally','import','from','as','True','False','None','and','or','not','in','is']),
    go: new Set(['func','package','import','return','if','else','for','switch','case','break','continue','type','struct','interface','map','chan','go','defer']),
    bash: new Set(['if','then','else','fi','for','while','do','done','case','esac','echo','export','return','in']),
  };
  const TYPE_MAP = { 0:'DEFAULT', 1:'KEYWORD', 2:'METHOD', 3:'STR', 4:'NUMBER', 5:'COMMENT' };
  const keywords = keywordsMap[lang] || new Set();
  const tokens = [];
  let i = 0;
  const n = code.length;

  const push = (cc, type) => {
    if (!cc) return;
    const last = tokens[tokens.length - 1];
    if (last && last.highlightType === type) last.codeContent += cc;
    else tokens.push({ codeContent: cc, highlightType: type });
  };
  const isWordStart = (c) => /[a-zA-Z_$]/.test(c);
  const isWord = (c) => /[a-zA-Z0-9_$]/.test(c);
  const isNum = (c) => /[0-9]/.test(c);

  while (i < n) {
    const c = code[i];
    if (c === '\n' || c === '\t' || c === ' ') {
      let s = i;
      while (i < n && /\s/.test(code[i])) i++;
      push(code.slice(s, i), 0); continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      let s = i; i += 2;
      while (i < n && code[i] !== '\n') i++;
      push(code.slice(s, i), 5); continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let s = i; const q = c; i++;
      while (i < n) {
        if (code[i] === '\\' && i + 1 < n) i += 2;
        else if (code[i] === q) { i++; break; }
        else i++;
      }
      push(code.slice(s, i), 3); continue;
    }
    if (isNum(c)) {
      let s = i;
      while (i < n && /[0-9.]/.test(code[i])) i++;
      push(code.slice(s, i), 4); continue;
    }
    if (isWordStart(c)) {
      let s = i;
      while (i < n && isWord(code[i])) i++;
      const word = code.slice(s, i);
      let type = 0;
      if (keywords.has(word)) type = 1;
      else {
        let j = i;
        while (j < n && /\s/.test(code[j])) j++;
        if (code[j] === '(') type = 2;
      }
      push(word, type); continue;
    }
    push(c, 0); i++;
  }
  return {
    codeBlock: tokens,
    unified_codeBlock: tokens.map(t => ({ content: t.codeContent, type: TYPE_MAP[t.highlightType] })),
  };
}

// ────────────────────────────────────────────────
// toTableMetadata
// ────────────────────────────────────────────────
function toTableMetadata(arr) {
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('Input harus array & tidak kosong');
  const [title, headerStr, ...rest] = arr;
  const splitCols = (str) => {
    if (typeof str !== 'string') return [];
    return str.includes('|') ? str.split('|').map(s => s.trim()) : str.split(',').map(s => s.trim());
  };
  const splitRows = (str) => {
    if (typeof str !== 'string') return [];
    return str.split(';;').map(splitCols);
  };
  const header = splitCols(headerStr);
  const parsedRows = rest.flatMap(splitRows);
  const maxLen = Math.max(header.length, ...parsedRows.map(r => r.length));
  const unified_rows = [
    { is_header: true, cells: [...header, ...Array(maxLen - header.length).fill('')] },
    ...parsedRows.map(cells => ({ is_header: false, cells: [...cells, ...Array(maxLen - cells.length).fill('')] })),
  ];
  const rows = unified_rows.map(r => ({ items: r.cells, ...(r.is_header ? { isHeading: true } : {}) }));
  return { title, rows, unified_rows };
}

// ────────────────────────────────────────────────
// parseAIReq: parser blok [==== BEGIN X ====] ... [==== END X ====]
// ────────────────────────────────────────────────
function parseAIReq(text) {
  const result = [];

  const smartSplit = (str) => {
    const out = [];
    let buf = '';
    let inQuote = false;
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '"' && str[i - 1] !== '\\') { inQuote = !inQuote; continue; }
      if (c === ',' && !inQuote) { out.push(buf.trim()); buf = ''; continue; }
      buf += c;
    }
    if (buf) out.push(buf.trim());
    return out;
  };

  const extract = (block) => {
    const res = [];
    let buf = '';
    let depth = 0;
    let inQuote = false;
    for (let i = 0; i < block.length; i++) {
      const c = block[i];
      if (c === '"' && block[i - 1] !== '\\') inQuote = !inQuote;
      if (!inQuote) {
        if (c === '[') depth++;
        if (c === ']') depth--;
      }
      if (depth > 0) buf += c;
      if (depth === 0 && buf) { res.push(buf); buf = ''; }
    }
    return res;
  };

  const normalize = (str) => str.replace(/\\(n|t|r|\\|"|')/g, (_, c) => {
    switch (c) { case 'n': return '\n'; case 't': return '\t'; case 'r': return '\r';
      case '\\': return '\\'; case '"': return '"'; case "'": return "'"; default: return c; }
  });

  const blockDefs = [
    { name: 'RESPONSE', type: 'response', min: 1 },
    { name: 'RICH_RESPONSE', type: 'rich_response', min: 1 },
    { name: 'TOOLS_CALL', type: 'tools_call', min: 1 },
  ];

  const regexAll = /\[==== BEGIN (RESPONSE|RICH_RESPONSE|TOOLS_CALL) ====][\s\S]*?\[==== END \1 ====]/gi;
  const segments = [];
  let lastIndex = 0;
  let match;
  while ((match = regexAll.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    segments.push({ type: 'block', raw: match[0], name: match[1] });
    lastIndex = regexAll.lastIndex;
  }
  if (lastIndex < text.length) segments.push({ type: 'text', content: text.slice(lastIndex) });

  let pendingText = '';
  for (const seg of segments) {
    if (seg.type === 'text') {
      pendingText += seg.content.trim() ? normalize(seg.content.trim()) : '';
      continue;
    }
    const def = blockDefs.find(b => b.name === seg.name);
    if (!def) continue;
    const inner = seg.raw.match(new RegExp(`\\[==== BEGIN ${def.name} ====]([\\s\\S]*?)\\[==== END ${def.name} ====]`, 'i'))?.[1] || '';
    const lines = extract(inner);
    const parsed = [];
    if (pendingText.length) {
      if (def.type === 'response' || def.type === 'tools_call') parsed.push(['SET_BODY', pendingText]);
      else if (def.type === 'rich_response') parsed.push(['ADD_TEXT', pendingText]);
      pendingText = '';
    }
    for (const line of lines) {
      const parts = smartSplit(line.slice(1, -1));
      if (parts.length >= def.min) parsed.push(parts.map(v => normalize(v)));
    }
    result.push({ type: def.type, data: parsed });
  }

  if (pendingText.trim() && result.length) {
    const last = [...result].reverse().find(r => r.type !== 'tools_call');
    if (last) {
      if (last.type === 'response') {
        const body = last.data.find(d => d[0] === 'SET_BODY');
        if (body) body[1] += pendingText.trim();
        else last.data.unshift(['SET_BODY', pendingText.trim()]);
      }
      if (last.type === 'rich_response') last.data.push(['ADD_TEXT', pendingText.trim()]);
    }
    pendingText = '';
  }

  if (!result.length && pendingText.trim()) {
    result.push({ type: 'response', data: [['SET_BODY', pendingText.trim()]] });
  }

  result.sort((a, b) => {
    if (a.type === 'tools_call') return 1;
    if (b.type === 'tools_call') return -1;
    return 0;
  });

  return result;
}

// ────────────────────────────────────────────────
// fioraResponse: handle blok RESPONSE → kirim Button + media + contact
// ────────────────────────────────────────────────
async function fioraResponse(response, conn, m, { startThinking }) {
  const btn = new Button();
  let body = '';
  let hasSelect = false;
  let lastButtonIndex = -1;

  for (let i = 0; i < response.length; i++) {
    const [type] = response[i];
    if (['SET_BODY', 'REPLY', 'URL', 'COPY', 'SELECT'].includes(type)) lastButtonIndex = i;
  }

  for (let i = 0; i < response.length; i++) {
    const [type, ...value] = response[i];

    if (type === 'SET_TITLE') btn.setTitle?.(value[0]);
    if (type === 'SET_BODY') { body = value[0] || ''; btn.setBody(body); }
    if (type === 'SET_FOOTER') btn.setFooter?.(value[0]);
    if (type === 'REPLY') btn.addReply(value[0], value[0]);
    if (type === 'URL') btn.addUrl(value[0], value[1], value[2] === 'true');
    if (type === 'COPY') btn.addCopy(value[0], value[1]);

    if (type === 'CONTACT') {
      const contacts = value.map(v => v.split(','));
      try {
        await conn.sendContact(m.chat, contacts, m, { messageId: generateFioraID() });
      } catch (e) { await m.reply('CONTACT error: ' + e.message); }
    }

    if (type === 'SELECT') {
      if (!hasSelect) {
        btn.addSelection('Options');
        btn.makeSections(global.namebot);
        hasSelect = true;
      }
      btn.makeRow('', value[0], value[1], (value[0] || '') + '\n' + (value[1] || ''));
    }

    if (type === 'MEDIA') {
      const [url, mediaType] = value;
      try {
        if (mediaType === 'image' || mediaType === 'video') {
          await conn.sendMessage(m.chat, { [mediaType]: { url } }, { quoted: m, messageId: generateFioraID() });
        } else if (mediaType === 'sticker') {
          await conn.sendSticker(m.chat, url, m, { packName: global.namebot, packPublish: global.author });
        } else if (mediaType === 'audio') {
          await conn.sendMessage(m.chat, { audio: { url }, mimetype: 'audio/mp4', ptt: false }, { quoted: m, messageId: generateFioraID() });
        }
      } catch (e) { await m.reply(`MEDIA error (${mediaType}): ${e.message}`); }
    }

    if (type === 'SPEECH') {
      try {
        const text = value[0].replace(/@(\d{5,})/g, (_m, num) => {
          const jid = num + '@s.whatsapp.net';
          return conn.getName(jid) || '';
        });
        // Pakai endpoint TTS Fiora; api_key di-disable (tidak ada `ajasendiri`)
        const ttsUrl = `https://tts.ornzora.eu.cc/tts?text=${encodeURIComponent(text)}&voice=${value[2] || 34}&lang=${value[1] || 0}&reverb=${value[3] || 0}`;
        const { data } = await conn.getFile(ttsUrl);
        const audio = await toPTT(data);
        const msg = await generateWAMessage(
          m.chat,
          { audio: audio.data, ptt: true, mimetype: 'audio/ogg; codecs=opus' },
          { quoted: m, upload: conn.waUploadToServer, messageId: generateFioraID() }
        );
        try { msg.message.audioMessage.waveform = await getWaveForm(data, 96); } catch {}
        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
      } catch (e) {
        await m.reply('SPEECH error: ' + e.message);
      }
    }

    if (i === lastButtonIndex && body.length) {
      try {
        btn.setContextInfo({ mentionedJid: conn.parseMention(body) });
        btn.setParams({
          limited_time_offer: {
            text: global.namebot,
            url: `AI Assistant (${formatMs(Date.now() - startThinking)}s)`,
          },
        });
        await btn.run(m.chat, conn, m, { messageId: generateFioraID() });
      } catch (e) {
        // Fallback: kalau Button gagal, kirim teks biasa
        await m.reply(body);
      }
    }
  }
}

// ────────────────────────────────────────────────
// fioraRichResponse: handle blok RICH_RESPONSE → relayMessage richResponse
// ────────────────────────────────────────────────
async function fioraRichResponse(rich_response, conn, m, { startThinking }) {
  if (rich_response.length === 1 && rich_response[0][0] === 'ADD_REASONING_LOG') return;

  const submessages = [];
  const sections = [];
  const reasoningBuffer = [];

  const pushText = (text) => {
    submessages.push({ messageType: 2, messageText: text });
    sections.push({
      view_model: { primitive: { text, __typename: 'GenAIMarkdownTextUXPrimitive' }, __typename: 'GenAISingleLayoutViewModel' },
    });
  };

  const pushCode = (language, code) => {
    const meta = tokenizer(code, language);
    submessages.push({ messageType: 5, codeMetadata: { codeLanguage: language, codeBlocks: meta.codeBlock } });
    sections.push({
      view_model: { primitive: { language, code_blocks: meta.unified_codeBlock, __typename: 'GenAICodeUXPrimitive' }, __typename: 'GenAISingleLayoutViewModel' },
    });
  };

  const pushTable = (table) => {
    const meta = toTableMetadata(table);
    submessages.push({ messageType: 4, tableMetadata: { title: meta.title, rows: meta.rows } });
    sections.push({
      view_model: { primitive: { rows: meta.unified_rows, __typename: 'GenATableUXPrimitive' }, __typename: 'GenAISingleLayoutViewModel' },
    });
  };

  const pushReason = async (text, url) => {
    let profile_url = global.namebot;
    try {
      profile_url = await conn.profilePictureUrl(conn.decodeJid(conn.user.id), 'image');
    } catch {}
    reasoningBuffer.push({
      source_type: 'THIRD_PARTY',
      source_display_name: text,
      source_subtitle: global.namebot,
      source_url: url || global.namebot,
      favicon: { url: profile_url, mime_type: 'image/jpeg', width: 16, height: 16 },
    });
  };

  await pushReason(`Berpikir selama ${formatMs(Date.now() - startThinking)} detik`);

  for (const item of rich_response) {
    const [type, ...value] = item;
    if (type === 'ADD_TEXT') pushText(value[0]);
    if (type === 'ADD_SNIPPET_CODE') pushCode(value[0], value[1]);
    if (type === 'ADD_TABLE') pushTable(value);
    if (type === 'ADD_REASONING_LOG') await pushReason(value[0], value[1]);
  }

  if (reasoningBuffer.length) {
    sections.push({
      view_model: { primitive: { sources: reasoningBuffer, __typename: 'GenAISearchResultPrimitive' }, __typename: 'GenAISingleLayoutViewModel' },
    });
  }

  const unified = { response_id: crypto.randomUUID(), sections };
  const content = {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
      botMetadata: { pluginMetadata: {}, richResponseSourcesMetadata: {} },
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages,
          unifiedResponse: { data: Buffer.from(JSON.stringify(unified)).toString('base64') },
          contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: '0@bot' },
            forwardOrigin: 4,
          },
        },
      },
    },
  };

  try {
    await conn.relayMessage(m.chat, content, { messageId: generateFioraID() });
  } catch (e) {
    // Fallback: render plain
    let plain = '';
    for (const it of rich_response) {
      const [t, ...v] = it;
      if (t === 'ADD_TEXT') plain += v[0] + '\n\n';
      if (t === 'ADD_SNIPPET_CODE') plain += '```' + (v[0] || '') + '\n' + (v[1] || '') + '\n```\n\n';
      if (t === 'ADD_TABLE') plain += `*${v[0]}*\n` + v.slice(1).join(' | ') + '\n\n';
    }
    if (plain.trim()) await m.reply(plain.trim());
  }
}

// ────────────────────────────────────────────────
// ResultBuilder & tools_call
// ────────────────────────────────────────────────
class ResultBuilder {
  constructor() { this.parts = [{ text: '[TOOLS_CALLS]' }]; }
  addText(text) { this.parts.push({ text: String(text) }); }
  addJSON(obj) { this.parts.push({ text: JSON.stringify(obj, null, 2) }); }
  addFile(url, mimeType = 'application/octet-stream') {
    this.parts.push({ fileData: { fileUri: url, mimeType } });
  }
  async addFileText(text, mimeType = 'text/plain', fileName = 'NIXEL') {
    if (typeof text !== 'string') throw new Error('text must be string');
    const { url } = await ornzora(Buffer.from(text), fileName);
    if (!url) throw new Error('upload failed');
    this.parts.push({ fileData: { fileUri: url, mimeType } });
  }
  build() { return this.parts; }
}

async function tools_call(tools, { conn, m }) {
  const result = new ResultBuilder();

  for (const tool of tools) {
    const [type, ...value] = tool;
    result.addText('TOOLS_NAME: ' + type);

    try {
      switch (String(type).toLowerCase()) {
        case 'download': {
          const res = await aiorapidapi(value[0]);
          if (res?.error) result.addJSON({ error: true, message: res.message });
          else result.addJSON({ result: { source: res.source, author: res.author, title: res.title, medias: res.medias } });
          break;
        }

        case 'page_create': {
          const baseUrl = 'https://fiora.nixel.my.id';
          const payload = { html: value[0], pathName: value[1] || undefined };
          const { data } = await axios.post(`${baseUrl}/api/upload`, payload);
          const { success, id, message } = data;
          result.addJSON({ baseUrl, success, id, url: `${baseUrl}/${id}`, message });
          break;
        }

        case 'page_content': {
          const baseUrl = 'https://fiora.nixel.my.id';
          const payload = { action: value[0], target: value[1], pathName: value[2], html: value[3] || '' };
          const { data } = await axios.post(`${baseUrl}/api/update`, payload);
          const { success, id, message } = data;
          result.addJSON({ baseUrl, success, id, url: `${baseUrl}/${id}`, message });
          break;
        }

        case 'capture_web': {
          const res = await imagy(value[0], {
            device: value[1] || 'dekstop',
            full_page: value[2] === 'true',
            device_scale: parseInt(value[3]) || 1,
          });
          result.addText(res);
          break;
        }

        case 'group_manage': {
          const [act, val] = value;
          const target = conn.parseMention('@' + val);
          const actions = {
            add_member:    async () => await conn.groupParticipantsUpdate(m.chat, target, 'add'),
            remove_member: async () => await conn.groupParticipantsUpdate(m.chat, target, 'remove'),
            promote:       async () => await conn.groupParticipantsUpdate(m.chat, target, 'promote'),
            demote:        async () => await conn.groupParticipantsUpdate(m.chat, target, 'demote'),
            set_subject:   async () => await conn.groupUpdateSubject(m.chat, val),
            set_description: async () => await conn.groupUpdateDescription(m.chat, val),
            set_profile:   async () => await conn.updateProfilePicture(m.chat, await getBuffer(val)),
            set_announce:  async () => await conn.groupSettingUpdate(m.chat, val === 'on' ? 'announcement' : 'not_announcement'),
            allow_member_edit_group: async () => await conn.groupSettingUpdate(m.chat, val === 'on' ? 'unlocked' : 'locked'),
          };
          if (actions[act]) {
            try { await actions[act](); result.addText('success'); }
            catch (e) { result.addText(e.message); }
          } else result.addText('action_not_found');
          break;
        }

        case 'get_group_metadata': {
          const jid = value[0].endsWith('@g.us') ? value[0] : value[0] + '@g.us';
          const metadata = await conn.groupMetadata(jid);
          const participants = metadata.participants || [];
          const bot = participants.find(u => conn.getJid(u.id) === conn.decodeJid(conn.user.id)) || {};
          const isBotAdmin = bot?.admin || false;
          let inviteLink = "Can't get group invite link.";
          if (isBotAdmin) {
            try { inviteLink = 'https://chat.whatsapp.com/' + await conn.groupInviteCode(m.chat); } catch {}
          }
          result.addJSON({
            result: {
              profile_url: await conn.profilePictureUrl(jid, 'image').catch(() => null),
              id: metadata?.id,
              subject: metadata?.subject ?? 'No subject.',
              description: metadata?.desc ?? 'No description.',
              inviteLink,
              owner: metadata?.ownerPn || metadata?.owner,
              send_mode: metadata.announce ? 'admin' : 'all',
              isInCommunity: metadata.isCommunity,
              member: participants.map(v => ({
                number: v.phoneNumber || v.id,
                role: v.admin === 'superadmin' ? 'owner' : v.admin === 'admin' ? 'admin' : 'member',
              })),
            },
          });
          break;
        }

        case 'get_user_data': {
          const num = value[0].startsWith('@') ? value[0] : '@' + value[0];
          const number = conn.parseMention(num)[0];
          const safe = async (fn) => { try { return await fn(); } catch { return null; } };
          const profile_url = await safe(() => conn.profilePictureUrl(number, 'image'));
          const name = await safe(() => conn.getName(number));
          const bio = await safe(async () => { const r = await conn.fetchStatus(number); return r?.[0]?.status ?? null; });
          result.addJSON({ result: { profile_url, name, number, bio } });
          break;
        }

        case 'edit_image': {
          try {
            let image = await getBuffer(value[0]);
            const ft = await fileTypeFromBuffer(image);
            if (ft?.ext === 'webp') image = await webpToJpg(image);
            const edit = await gptimage({ image, prompt: value[1], model: 'gpt-image-1.5' });
            const url = (await ornzora(edit)).url;
            result.addText(url);
          } catch (e) { result.addText(e.message); }
          break;
        }

        case 'create_image': {
          try {
            const banana = new AIBanana();
            const res = await banana.generateImage(value[0]);
            result.addJSON({ success: res.success, result: res.images });
          } catch (e) { result.addText(e.message); }
          break;
        }

        case 'search': {
          const platform = value[0];
          const query = value[1];
          const out = { platform, query, result: null, error: false, message: null };
          try {
            switch (platform) {
              case 'google': {
                const a = await googleSearch(query);
                if (a.error) { out.error = true; out.message = a.data; }
                else out.result = a.data;
                break;
              }
              case 'tiktok': {
                const baseUrl = 'https://www.tikwm.com';
                const r = (await axios.get(`https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(query)}&count=25&cursor=0&web=1&hd=1`)).data;
                if (!r.data?.videos?.length) out.result = 'Not found.';
                else out.result = r.data.videos.map(v => ({
                  author: { nickname: v.author.nickname, username: v.author.unique_id, avatar: baseUrl + v.author.avatar },
                  region: v.region, title: v.title, thumbnail: baseUrl + v.cover,
                  no_watermark: baseUrl + v.play, with_watermark: baseUrl + v.wmplay,
                  size: v.size, music: baseUrl + v.music, music_info: v.music_info,
                  watched: v.play_count, comment: v.comment_count, shared: v.share_count,
                  download: v.download_count, createdAt: v.create_time,
                }));
                break;
              }
              case 'lyrics': {
                const a = await lyricsSearch(query);
                if (!a?.length) { out.error = true; out.message = 'Not Found.'; }
                else out.result = { lyrics: a.find(v => v.syncedLyrics)?.syncedLyrics ?? a[0].plainLyrics };
                break;
              }
              case 'spotify': {
                const sp = new SpotDown();
                out.result = await sp.search(query);
                out.message = 'FYI - Hasil masih mentah dan perlu di download.';
                break;
              }
              case 'youtube': {
                out.result = await youtubeSearch(query);
                out.message = 'FYI: hasil masih berupa data mentah dan harus di-download.';
                break;
              }
              case 'pinterest': {
                const r = await pins(query);
                if (!r?.length) { out.error = true; out.message = 'Image not found.'; }
                else { out.result = r; out.message = 'Disarankan mencantumkan author, title, dan description.'; }
                break;
              }
              case 'instagram': {
                const r = await reelsSearch(query);
                if (!r?.length) { out.error = true; out.message = 'Video not found.'; }
                else out.result = r;
                break;
              }
              default: { out.error = true; out.message = 'Platform not supported'; }
            }
          } catch (err) { out.error = true; out.message = err?.message || 'Internal error'; }
          result.addJSON(out);
          break;
        }

        case 'get_file': {
          result.addFile(value[0], value[1]);
          break;
        }

        case 'fetch': {
          const r = await axios.get(value[0]);
          let data = r.data;
          if (Buffer.isBuffer(data)) data = data.toString('utf-8');
          else if (typeof data === 'object') data = JSON.stringify(data, null, 2);
          else data = String(data);
          await result.addFileText(data, 'text/html', String(type));
          break;
        }

        case 'brat': {
          result.addText('https://shinana-brat.hf.space/?text=' + encodeURIComponent(value[0]));
          break;
        }

        default: {
          result.addText('TOOLS_NOT_FOUND');
          break;
        }
      }
    } catch (e) {
      result.addText(e.message);
    }
  }

  return result.build();
}

// ────────────────────────────────────────────────
// serializeMessage: bangun parts[] untuk Gemini dari pesan WA
// ────────────────────────────────────────────────
async function serializeMessage(conn, m, input, { groupMetadata }) {
  const isMedia = /image|video|audio|sticker|document/i;
  const isCodeLike = (mime = '') => /^text\//i.test(mime) || /json|javascript|html|css|csv|markdown/i.test(mime);
  const isOffice = (mime = '') => mime.includes('officedocument') || mime.includes('msword') || mime.includes('excel') || mime.includes('powerpoint');

  const upload = async (msg) => {
    if (!msg || !isMedia.test(msg.mtype || '')) return null;
    let buffer;
    try { buffer = await msg.download(); } catch { return null; }
    if (!buffer) return null;

    const type = await fileTypeFromBuffer(buffer).catch(() => null);
    let mime = type?.mime || msg.mimetype || msg?.message?.[msg.mtype]?.mimetype || 'application/octet-stream';

    if (/^(image|video|audio)\//i.test(mime) || mime === 'application/pdf') {
      try {
        const link = (await ornzora(buffer)).url;
        if (!link) return null;
        return { kind: 'media', url: link, mimetype: mime };
      } catch { return { kind: 'text', text: '[UPLOAD_FAILED]', mimetype: mime }; }
    }
    if (isOffice(mime)) {
      return { kind: 'text', text: '[OFFICE_NOT_SUPPORTED] mime: ' + mime, mimetype: mime };
    }
    if (isCodeLike(mime)) {
      let text = buffer.toString('utf-8');
      if (text.length > 8000) text = text.slice(0, 8000) + '\n...[truncated]';
      return { kind: 'text', text, mimetype: mime };
    }
    return { kind: 'text', text: `[FILE NOT SUPPORTED]\nmime: ${mime}\nsize: ${buffer.length} bytes`, mimetype: mime };
  };

  const getType = (msg) => {
    if (!msg) return null;
    const mt = msg.mtype || '';
    if (/image/i.test(mt)) return 'image';
    if (/video/i.test(mt)) return 'video';
    if (/audio/i.test(mt)) return 'audio';
    if (/sticker/i.test(mt)) return 'sticker';
    if (/document/i.test(mt)) return 'document';
    return 'unknown';
  };

  const mFile = await upload(m);
  const qFile = m.quoted ? await upload(m.quoted) : null;
  const time = getWIBDateTime();

  const userBlock = `========== USER ==========
username: ${conn.getName(m.sender)}
number: @${m.sender.split('@')[0]}
time: ${time.hari}, ${time.tanggal} ${time.bulan} ${time.tahun} ${time.jamSaja}:${time.menit}:${time.detik} WIB
chat_id: ${m.chat}
message_id: ${m.id}
is_group: ${m.isGroup}
group_name: ${m.isGroup ? (groupMetadata?.subject || '-') : '-'}

========== MESSAGE ==========
type: ${m.mtype}
text: ${input || ''}${mFile?.kind === 'media' ? `\nurl: ${mFile.url}` : ''}`;

  let payload_text = userBlock;
  if (m.quoted) {
    const quotedBlock = `========== QUOTED ==========
username: ${conn.getName(m.quoted.sender)}
number: ${m.quoted.sender}
message_id: ${m.quoted.id}
is_group: ${m.isGroup}
group_name: ${m.isGroup ? (groupMetadata?.subject || '-') : '-'}

========== QUOTED MESSAGE ==========
type: ${m.quoted.mtype}
text: ${m.quoted.text || ''}${qFile?.kind === 'media' ? `\nurl: ${qFile.url}` : ''}`;
    payload_text += `\n\n${quotedBlock}`;
  }
  payload_text += `\n============================`;

  const parts = [{ text: payload_text }];

  for (const f of [mFile, qFile]) {
    if (!f) continue;
    if (f.kind === 'media') {
      parts.push({ text: `[MEDIA_CONTEXT]\nmime: ${f.mimetype}\nurl: ${f.url}` });
      parts.push({ fileData: { fileUri: f.url, mimeType: f.mimetype } });
    } else {
      parts.push({ text: `[MEDIA_CONTEXT]\nmime: ${f.mimetype}` });
      parts.push({ text: f.text });
    }
  }

  return parts;
}

// ────────────────────────────────────────────────
// prompt: system prompt Fiora
// ────────────────────────────────────────────────
function prompt(user, m, conn) {
  const time = getWIBDateTime();
  const botJid = (() => { try { return conn.decodeJid(conn.user.id); } catch { return ''; } })();
  const botLid = (() => { try { return conn.decodeJid(conn.user.lid); } catch { return ''; } })();
  return `Kamu adalah AI Assistant ${global.namebot}, dibuat oleh ${global.author}.

--------------------------------------------------

[CONTEXT DATA]
User: ${user}
[TIME] ${time.hari} ${time.tanggal}/${time.bulan}/${time.tahun} ${time.jamSaja}:${time.menit}:${time.detik} WIB
[PREFERENSI] Bahasa: Indonesia | Platform: WhatsApp
[META] isGroup: ${m.isGroup} | isQuoted: ${!!m.quoted} | Bot JID: ${botJid} | Bot LID: ${botLid}

--------------------------------------------------

[Special Execution Context]
Berjalan di lingkungan khusus (WhatsApp-based system) yang menggunakan parser.
Setiap output bukan sekadar teks, tapi instruksi yang akan diproses sistem.
Output yang tidak sesuai format akan gagal diproses.

[RESPONSE & TOOLS SYSTEM]
Gunakan format berikut jika sesuai kebutuhan:

[==== BEGIN RESPONSE ====]
[TYPE, "arg1", "arg2"]
[==== END RESPONSE ====]

[==== BEGIN RICH_RESPONSE ====]
[TYPE, "arg1", "arg2"]
[==== END RICH_RESPONSE ====]

[==== BEGIN TOOLS_CALL ====]
[TYPE, "arg1", "arg2"]
[==== END TOOLS_CALL ====]

ATURAN DASAR:
- Semua value harus string
- Tidak boleh ada teks di dalam blok
- Jika ada fungsi → WAJIB masuk ke blok
- Teks di luar blok tidak akan ditampilkan

FORMAT SELECTION:
1. RESPONSE → interaksi (REPLY, COPY), pilihan (SELECT), link (URL), media (MEDIA)
2. RICH_RESPONSE → penjelasan panjang, soal, list banyak item, konten terstruktur
3. TOOLS_CALL → eksekusi sistem (download, search), butuh data tambahan

========================
RESPONSE
========================
[SET_TITLE, "text"]   → Judul (opsional)
[SET_BODY, "text"]    → Isi utama (WAJIB untuk konten)
[SET_FOOTER, "text"]  → Penutup (opsional)
[REPLY, "text"]       → Tombol balasan cepat
[SELECT, "title", "description"] → Pilihan (boleh banyak)
[URL, "text", "url", "web_interaction"] → "true"=buka di WA, "false"=browser
[COPY, "label", "value"] → Tombol copy
[MEDIA, "url", "type"] → type: image|video|audio|sticker
[CONTACT, "number,name", ...] → Kirim kontak
[SPEECH, "text", "language?", "voice_id?", "effect?"] → TTS voice note (jarang!)

========================
RICH_RESPONSE
========================
[ADD_TEXT, "text"]                   → Teks pendukung
[ADD_TABLE, "title", "col1|col2", "r1c1|r1c2;;r2c1|r2c2"] → Tabel
[ADD_SNIPPET_CODE, "language", "code"] → Code snippet
[ADD_REASONING_LOG, "text", "url"]   → Reasoning step

========================
TOOLS_CALL
========================
[DOWNLOAD, "url"]                    → TikTok, IG, YouTube, FB, dll
[SEARCH, "platform", "query"]        → youtube|tiktok|instagram|pinterest|spotify|lyrics|google
[GET_FILE, "url", "mimetype"]        → Ambil file dari URL
[FETCH, "url"]                       → Ambil isi halaman web
[BRAT, "text"]                       → Sticker brat
[PAGE_CREATE, "html", "webpath"]     → Generate halaman web
[PAGE_CONTENT, "action", "target", "webpath", "html"]
[CAPTURE_WEB, "url", "?device", "?fullpage", "?device_scale"]
[EDIT_IMAGE, "url", "instruction"]
[CREATE_IMAGE, "prompt"]
[GET_GROUP_METADATA, "groupid@g.us"]
[GET_USER_DATA, "number"]
[GROUP_MANAGE, "action", "value"]    → Hanya admin

ATURAN:
- DEFAULT setelah TOOLS_CALL: DIAM
- Maks 5 TOOLS_CALL per sesi
- Jangan tampilkan format internal tools
- Gunakan format WhatsApp native: *bold* _italic_ ~strike~ \`\`\`code\`\`\`
- Mention: @628xxxxxxxxxx (angka saja)
- Tidak mendukung LaTeX
`;
}

// ────────────────────────────────────────────────
// buildContext: ambil history yang relevan untuk chat ini
// ────────────────────────────────────────────────
function buildContext(chatJid, userJid, { limit = 30, fileDataLimit = 5 } = {}) {
  const all = getChatHistory(chatJid).slice();
  all.sort((a, b) => a.timestamp - b.timestamp);

  // Pasangkan user→assistant secara berurutan
  const result = [];
  for (let i = 0; i < all.length; i++) {
    const msg = all[i];
    if (msg.role !== 'user') continue;
    let assistantMsg = null;
    for (let j = i + 1; j < all.length; j++) {
      if (all[j].role === 'assistant') { assistantMsg = all[j]; break; }
      if (all[j].role === 'user') break;
    }
    result.push({ role: 'user', parts: msg.parts });
    if (assistantMsg) result.push({ role: 'assistant', parts: assistantMsg.parts });
  }

  const sliced = result.slice(-limit);

  // fileData hanya untuk N user message terakhir, sisanya disembunyikan
  const userIdx = [];
  for (let i = 0; i < sliced.length; i++) if (sliced[i].role === 'user') userIdx.push(i);
  const allowedFile = new Set(userIdx.slice(-fileDataLimit));

  return sliced.map((msg, idx) => {
    if (msg.role !== 'user') return msg;
    const allow = allowedFile.has(idx);
    return {
      role: 'user',
      parts: msg.parts?.map(p => {
        if (p.fileData && !allow) return { text: 'File disembunyikan. Gunakan GET_FILE untuk mengambil ulang.' };
        return p;
      }),
    };
  });
}

// ────────────────────────────────────────────────
// fioraInner: rekursif (untuk tools_call)
// ────────────────────────────────────────────────
async function fioraInner(conn, m, input, { isToolCall = false, groupMetadata, depth = 0 } = {}) {
  if (depth > 5) {
    await m.reply('⚠️ Tool call recursion limit (5).');
    return;
  }

  await m.react(getRandomEmoji());
  const isDebug = DEBUG_USERS.has(m.sender);
  const startThinking = Date.now();
  let debugText = '';
  let key, start, total = 0;

  if (isDebug) {
    debugText = '[GENERATING PAYLOAD]';
    const sent = await m.reply(debugText);
    key = sent?.key;
    start = Date.now();
  }

  // Bangun parts untuk turn ini
  const parts = isToolCall ? input : await serializeMessage(conn, m, input, { groupMetadata });
  const contextMessages = buildContext(m.chat, m.sender, { limit: 30, fileDataLimit: 5 });

  if (isDebug) {
    debugText += ` ${Date.now() - start}ms\n[REQUESTING GEMINI]`;
    if (key) await m.edit(debugText, key);
    total += Date.now() - start;
    start = Date.now();
  }

  let res;
  try {
    res = await gemini.chat({
      maxOutputTokens: 15000,
      contents: [
        { role: 'user', parts: [{ text: prompt(conn.getName(m.sender), m, conn) }] },
        ...contextMessages,
        { role: 'user', parts },
      ],
    });
  } catch (err) {
    if ((err.message || '').includes('empty response')) {
      await m.reply('Aku tidak mengerti maksudmu, bisa kau ulangi lagi?');
    } else {
      await m.reply('Terjadi kesalahan AI:\n' + (err.message || err.stack || String(err)).slice(0, 600));
    }
    return;
  }

  if (isDebug) {
    debugText += ` ${Date.now() - start}ms\n[PARSING RESULT]`;
    if (key) await m.edit(debugText, key);
    total += Date.now() - start;
    start = Date.now();
  }

  const parsed = parseAIReq(res);
  let result_tool = null;

  for (const block of parsed) {
    if (block.type === 'response') {
      await fioraResponse(block.data, conn, m, { startThinking });
    } else if (block.type === 'rich_response') {
      await fioraRichResponse(block.data, conn, m, { startThinking });
    } else if (block.type === 'tools_call') {
      await m.react('🔎');
      result_tool = await tools_call(block.data, { conn, m });
    }
  }

  if (isDebug) {
    debugText += ` ${Date.now() - start}ms\n[TOTAL] ${total + (Date.now() - start)}ms`;
    if (key) await m.edit(debugText, key);
  }

  // Simpan history
  const hist = getChatHistory(m.chat);
  hist.push({ role: 'user', parts, userJid: m.sender, timestamp: Date.now() });
  hist.push({ role: 'assistant', parts: [{ text: res }], userJid: m.sender, timestamp: Date.now() });
  if (hist.length > HISTORY_LIMIT_PER_CHAT) hist.splice(0, hist.length - HISTORY_LIMIT_PER_CHAT);

  await m.react('');

  if (result_tool) {
    await fioraInner(conn, m, result_tool, { isToolCall: true, groupMetadata, depth: depth + 1 });
  }
}

// ────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────
export async function runFiora(hisoka, m, input, { groupMetadata } = {}) {
  const conn = makeConn(hisoka);
  const mF = makeM(hisoka, m);

  const lower = (input || '').trim().toLowerCase();
  if (lower === 'fioradebug' || lower === 'debug') {
    if (DEBUG_USERS.has(m.sender)) DEBUG_USERS.delete(m.sender);
    else DEBUG_USERS.add(m.sender);
    await mF.reply('DEBUG IS ' + (DEBUG_USERS.has(m.sender) ? 'ON' : 'OFF'));
    return;
  }
  if (lower === 'reset' || lower === 'clear' || lower === 'hapus chat' || lower === 'mulai baru') {
    clearFioraHistory(m.chat);
    await mF.reply('🗑️ Memory percakapan untuk chat ini sudah dihapus.');
    return;
  }

  const text = input ? input : (mF.quoted?.text || '');
  if (!text) {
    await mF.reply('Masukkan pertanyaan atau perintah!\n\nContoh: .wily apa itu AI');
    return;
  }

  await fioraInner(conn, mF, text, { groupMetadata });
}

export default runFiora;
