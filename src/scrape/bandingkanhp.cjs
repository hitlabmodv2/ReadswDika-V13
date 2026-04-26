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
'use strict';

const { cekHP, getHPImage } = require('./cekhp.cjs');

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSpec(specs, cat, keys) {
  const catData = specs[cat];
  if (!catData) return null;
  for (const k of keys) {
    const v = catData[k];
    if (v && v !== '-') return v.split('\n')[0].trim();
  }
  return null;
}

function shortVal(val, max = 38) {
  if (!val) return '—';
  const s = String(val).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Ambil angka terbesar dari string, mis. "8GB RAM, 128GB" → max(8,128) */
function parseMaxNum(str = '') {
  const nums = [...String(str).matchAll(/[\d]+(?:\.\d+)?/g)].map(m => parseFloat(m[0]));
  return nums.length ? Math.max(...nums) : 0;
}

/** Ambil angka pertama dari string */
function parseFirstNum(str = '') {
  const m = String(str).match(/[\d]+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

/** Bersihkan query dari varian RAM/storage: "vivo v50 lite 8gb/128gb" → "vivo v50 lite" */
function stripVariant(query = '') {
  return query
    .replace(/\b\d+\s*gb\s*[\/+]\s*\d+\s*gb\b/gi, '')
    .replace(/\b\d+\s*gb\b/gi, '')
    .replace(/\b\d+\s*tb\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Scoring engine ────────────────────────────────────────────────────────────

/**
 * Setiap kategori punya extractor dan arah (higher=better atau lower=better).
 * Return: [ numA, numB ] atau [ valA, valB ] untuk perbandingan teks.
 */
const SCORE_CATEGORIES = [
  {
    id: 'ram',
    label: 'RAM',
    icon: '🧠',
    extract: (specs) => {
      const v = getSpec(specs, 'Memory', ['Internal']);
      if (!v) return null;
      // "8GB RAM, 128GB" → ambil angka sebelum "RAM"
      const m = v.match(/([\d.]+)\s*GB\s+RAM/i);
      return m ? parseFloat(m[1]) : null;
    },
    higher: true,
    unit: 'GB',
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: '💾',
    extract: (specs) => {
      const v = getSpec(specs, 'Memory', ['Internal']);
      if (!v) return null;
      // "8GB RAM, 128GB" atau "128GB 8GB RAM" → angka terbesar yg bukan RAM
      const m = v.match(/([\d]+)\s*GB(?!\s*RAM)/gi);
      if (!m) return null;
      const vals = m.map(s => parseFloat(s));
      return Math.max(...vals);
    },
    higher: true,
    unit: 'GB',
  },
  {
    id: 'battery',
    label: 'Baterai',
    icon: '🔋',
    extract: (specs) => {
      const v = getSpec(specs, 'Battery', ['Type']);
      return v ? parseFirstNum(v) : null;
    },
    higher: true,
    unit: 'mAh',
  },
  {
    id: 'charging',
    label: 'Charging',
    icon: '⚡',
    extract: (specs) => {
      const v = getSpec(specs, 'Battery', ['Charging']);
      return v ? parseFirstNum(v) : null;
    },
    higher: true,
    unit: 'W',
  },
  {
    id: 'maincam',
    label: 'Kamera Utama',
    icon: '📷',
    extract: (specs) => {
      const v = getSpec(specs, 'Main Camera', ['Triple', 'Quad', 'Dual', 'Single']);
      return v ? parseMaxNum(v) : null;
    },
    higher: true,
    unit: 'MP',
  },
  {
    id: 'selfiecam',
    label: 'Kamera Depan',
    icon: '🤳',
    extract: (specs) => {
      const v = getSpec(specs, 'Selfie camera', ['Single', 'Dual']);
      return v ? parseFirstNum(v) : null;
    },
    higher: true,
    unit: 'MP',
  },
  {
    id: 'display_size',
    label: 'Layar',
    icon: '🖥️',
    extract: (specs) => {
      const v = getSpec(specs, 'Display', ['Size']);
      return v ? parseFirstNum(v) : null;
    },
    higher: true,
    unit: '"',
  },
  {
    id: 'refresh',
    label: 'Refresh Rate',
    icon: '🔄',
    extract: (specs) => {
      const v = getSpec(specs, 'Display', ['Type']);
      const m = (v || '').match(/(\d+)Hz/i);
      return m ? parseFloat(m[1]) : null;
    },
    higher: true,
    unit: 'Hz',
  },
  {
    id: 'weight',
    label: 'Bobot',
    icon: '⚖️',
    extract: (specs) => {
      const v = getSpec(specs, 'Body', ['Weight']);
      return v ? parseFirstNum(v) : null;
    },
    higher: false, // lebih ringan = lebih baik
    unit: 'g',
  },
];

/** Jalankan scoring dan kembalikan skor detail */
function scorePhones(a, b) {
  let winsA = 0, winsB = 0, draws = 0;
  const rows = [];

  for (const cat of SCORE_CATEGORIES) {
    const numA = cat.extract(a.specs);
    const numB = cat.extract(b.specs);

    if (numA === null && numB === null) continue;

    let winnerA = false, winnerB = false;

    if (numA !== null && numB !== null && numA !== numB) {
      if (cat.higher) {
        winnerA = numA > numB;
        winnerB = numB > numA;
      } else {
        winnerA = numA < numB;
        winnerB = numB < numA;
      }
      if (winnerA) winsA++;
      else if (winnerB) winsB++;
    } else if (numA === numB && numA !== null) {
      draws++;
    } else if (numA !== null && numB === null) {
      winnerA = true; winsA++;
    } else if (numB !== null && numA === null) {
      winnerB = true; winsB++;
    }

    const displayA = numA !== null ? `${numA}${cat.unit}` : '—';
    const displayB = numB !== null ? `${numB}${cat.unit}` : '—';

    rows.push({ cat, displayA, displayB, winnerA, winnerB, numA, numB });
  }

  const total = winsA + winsB + draws;
  const pctA = total > 0 ? Math.round((winsA / (winsA + winsB || 1)) * 100) : 50;
  const pctB = 100 - pctA;

  return { rows, winsA, winsB, draws, pctA, pctB };
}

// ── Bar chart ASCII ──────────────────────────────────────────────────────────

function progressBar(pct, width = 10) {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ── Format teks perbandingan ─────────────────────────────────────────────────

function formatComparison(a, b, variantA = '', variantB = '') {
  const nameA = a.name || 'HP A';
  const nameB = b.name || 'HP B';

  const labelA = variantA ? `${nameA} (${variantA})` : nameA;
  const labelB = variantB ? `${nameB} (${variantB})` : nameB;

  const priceA = a.priceInfo?.raw ? a.priceInfo.raw.slice(0, 30) : '—';
  const priceB = b.priceInfo?.raw ? b.priceInfo.raw.slice(0, 30) : '—';

  const idrA = a.priceInfo?.idr
    ? 'Rp ' + Math.round(a.priceInfo.idr).toLocaleString('id-ID')
    : null;
  const idrB = b.priceInfo?.idr
    ? 'Rp ' + Math.round(b.priceInfo.idr).toLocaleString('id-ID')
    : null;

  const { rows, winsA, winsB, draws, pctA, pctB } = scorePhones(a, b);

  const overallWinner = winsA > winsB ? labelA : winsB > winsA ? labelB : null;
  const barA = progressBar(pctA);
  const barB = progressBar(pctB);

  let out = '';

  // ── Header ──
  out += `╭─「 📱 *BANDINGKAN HP* 」\n`;
  out += `│\n`;
  out += `│ 🅰️ *${labelA}*\n`;
  out += `│ 🅱️ *${labelB}*\n`;
  out += `│\n`;

  // ── Skor keseluruhan ──
  out += `├─「 🏆 *SKOR KESELURUHAN* 」\n`;
  out += `│\n`;
  out += `│ 🅰️ [${barA}] ${pctA}%\n`;
  out += `│ 🅱️ [${barB}] ${pctB}%\n`;
  out += `│\n`;
  if (overallWinner) {
    out += `│ 🏆 *Pemenang: ${overallWinner}*\n`;
  } else {
    out += `│ 🤝 *Hasil: SERI*\n`;
  }
  out += `│ _(${winsA} vs ${winsB} kategori`;
  if (draws > 0) out += `, ${draws} seri`;
  out += `)_\n`;
  out += `│\n`;

  // ── Harga ──
  out += `├─「 💰 *Harga Global* 」\n`;
  out += `│ 🅰️ ${priceA}\n`;
  out += `│ 🅱️ ${priceB}\n`;
  if (idrA || idrB) {
    out += `│\n`;
    out += `├─「 🇮🇩 *Estimasi IDR* 」\n`;
    if (idrA) out += `│ 🅰️ ${idrA}\n`;
    if (idrB) out += `│ 🅱️ ${idrB}\n`;
  }
  out += `│\n`;

  // ── Kategori detail ──
  out += `├─「 ⚡ *Detail Perbandingan* 」\n`;

  for (const row of rows) {
    const markerA = row.winnerA ? ' 🏆' : '';
    const markerB = row.winnerB ? ' 🏆' : '';
    out += `│\n`;
    out += `│ ${row.cat.icon} *${row.cat.label}*\n`;
    out += `│ 🅰️ ${row.displayA}${markerA}\n`;
    out += `│ 🅱️ ${row.displayB}${markerB}\n`;
  }

  // ── Spesifikasi teks (layar, chipset, OS, kamera teks, dll) ──
  const TEXT_SPECS = [
    { label: 'OS',        icon: '🤖', cat: 'Platform',      keys: ['OS'] },
    { label: 'Chipset',   icon: '⚙️', cat: 'Platform',      keys: ['Chipset'] },
    { label: 'CPU',       icon: '🖥️', cat: 'Platform',      keys: ['CPU'] },
    { label: 'GPU',       icon: '🎮', cat: 'Platform',      keys: ['GPU'] },
    { label: 'Layar Info',icon: '📺', cat: 'Display',       keys: ['Size'] },
    { label: 'Panel',     icon: '🎨', cat: 'Display',       keys: ['Type'] },
    { label: 'Resolusi',  icon: '🔍', cat: 'Display',       keys: ['Resolution'] },
    { label: 'RAM+ROM',   icon: '💽', cat: 'Memory',        keys: ['Internal'] },
    { label: 'Cam Utama', icon: '📸', cat: 'Main Camera',   keys: ['Triple','Quad','Dual','Single'] },
    { label: 'Cam Depan', icon: '🤳', cat: 'Selfie camera', keys: ['Single','Dual'] },
    { label: 'Baterai',   icon: '🔋', cat: 'Battery',       keys: ['Type'] },
    { label: 'Charging',  icon: '⚡', cat: 'Battery',       keys: ['Charging'] },
    { label: 'NFC',       icon: '📡', cat: 'Comms',         keys: ['NFC'] },
    { label: 'Dimensi',   icon: '📐', cat: 'Body',          keys: ['Dimensions'] },
    { label: 'Berat',     icon: '⚖️', cat: 'Body',          keys: ['Weight'] },
    { label: 'Rilis',     icon: '🚀', cat: 'Launch',        keys: ['Announced'] },
  ];

  out += `│\n`;
  out += `├─「 📋 *Spesifikasi Lengkap* 」\n`;

  for (const sp of TEXT_SPECS) {
    const vA = getSpec(a.specs, sp.cat, sp.keys);
    const vB = getSpec(b.specs, sp.cat, sp.keys);
    if (!vA && !vB) continue;
    out += `│\n`;
    out += `│ ${sp.icon} *${sp.label}*\n`;
    out += `│ 🅰️ ${shortVal(vA)}\n`;
    out += `│ 🅱️ ${shortVal(vB)}\n`;
  }

  out += `│\n`;
  out += `╰────────────────────\n`;
  out += `_📡 Data realtime GSMArena • Gunakan .cekhp untuk detail penuh_`;

  return out;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetch data + gambar kedua HP secara paralel.
 * variantA/variantB: string varian yg distrip dari query asli (misal "8GB/128GB")
 */
async function bandingkanHP(rawQueryA, rawQueryB) {
  // Ekstrak varian (misal "8GB/128GB") dari query user sebelum search
  function extractVariant(q) {
    const match = q.match(/\b(\d+\s*GB\s*[\/+]\s*\d+\s*GB)\b/i)
      || q.match(/\b(\d+\s*GB)\b/i);
    return match ? match[1].replace(/\s+/g, '').toUpperCase() : '';
  }

  const variantA = extractVariant(rawQueryA);
  const variantB = extractVariant(rawQueryB);

  const cleanA = stripVariant(rawQueryA);
  const cleanB = stripVariant(rawQueryB);

  // Fetch spesifikasi kedua HP dan gambarnya secara paralel
  const [a, b] = await Promise.all([
    cekHP(cleanA || rawQueryA),
    cekHP(cleanB || rawQueryB),
  ]);

  const [imgA, imgB] = await Promise.all([
    getHPImage(a.image, a.bigpicUrl).catch(() => null),
    getHPImage(b.image, b.bigpicUrl).catch(() => null),
  ]);

  const text = formatComparison(a, b, variantA, variantB);

  return { a, b, imgA, imgB, text, variantA, variantB };
}

module.exports = { bandingkanHP, formatComparison, scorePhones };
