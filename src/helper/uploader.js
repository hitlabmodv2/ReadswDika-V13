/**
 * ───────────────────────────────
 *  Uploader Module
 *  Source asli : Nixel (wa.me/6282139672290)
 *  Adapt utk Wily Bot
 * ───────────────────────────────
 *  Fungsi upload buffer -> URL
 *  Provider: catbox, imgbb, ornzora, vikingfile
 * ───────────────────────────────
 */

import axios from 'axios';
import FormData from 'form-data';
import crypto from 'crypto';

const UA = 'Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36';

export async function catbox(buffer, filename) {
        if (!Buffer.isBuffer(buffer)) throw new Error('Input must be a Buffer.');

        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('userhash', '');
        form.append('fileToUpload', buffer, filename || `${Date.now()}_wily.bin`);

        const { headers } = await axios.get('https://catbox.moe/');
        const { data } = await axios.post('https://catbox.moe/user/api.php', form, {
                headers: {
                        ...form.getHeaders(),
                        cookie: headers['set-cookie']?.join('; ') || '',
                        origin: 'https://catbox.moe',
                        referer: 'https://catbox.moe/',
                        'user-agent': UA,
                        'x-requested-with': 'XMLHttpRequest'
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity
        });

        if (typeof data !== 'string' || !data.startsWith('http')) {
                throw new Error(`Catbox response invalid: ${String(data).slice(0, 120)}`);
        }
        return data.trim();
}

export async function imgbb(buffer, filename) {
        if (!Buffer.isBuffer(buffer)) throw new Error('Input must be a Buffer.');

        const { data: html, headers } = await axios.get('https://imgbb.com/');
        const token = html.match(/auth_token\s*=\s*["']([a-f0-9]+)["']/)?.[1];
        if (!token) throw new Error('Failed to extract imgbb auth_token.');

        const form = new FormData();
        form.append('source', buffer, filename || `${Date.now()}_wily.jpg`);
        form.append('type', 'file');
        form.append('action', 'upload');
        form.append('timestamp', Date.now().toString());
        form.append('auth_token', token);

        const { data } = await axios.post('https://imgbb.com/json', form, {
                headers: {
                        ...form.getHeaders(),
                        cookie: headers['set-cookie']?.join('; ') || '',
                        origin: 'https://imgbb.com',
                        referer: 'https://imgbb.com/',
                        'user-agent': UA
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity
        });

        const url = data?.image?.image?.url || data?.image?.url || data?.image?.image;
        if (!url) throw new Error('imgbb upload failed.');
        return url;
}

export async function ornzora(buffer, filename) {
        if (!Buffer.isBuffer(buffer)) throw new Error('Input must be a Buffer.');

        const form = new FormData();
        form.append('file', buffer, { filename: filename || `${Date.now()}_wily.bin` });

        const { data } = await axios.post('https://cdn.ornzora.eu.cc/upload', form, {
                headers: { ...form.getHeaders() },
                maxBodyLength: Infinity,
                maxContentLength: Infinity
        });

        const url = data?.url || data?.data?.url || data?.result?.url;
        if (!url) throw new Error(`ornzora upload failed: ${JSON.stringify(data).slice(0, 120)}`);
        return url;
}

export async function vikingfile(buffer, filename) {
        if (!Buffer.isBuffer(buffer)) throw new Error('Input must be a Buffer.');

        const inst = axios.create({
                baseURL: 'https://vikingfile.com/api',
                headers: {
                        origin: 'https://vikingfile.com',
                        referer: 'https://vikingfile.com/',
                        'user-agent': UA
                }
        });

        const form = new FormData();
        form.append('size', buffer.length);
        const { data: up } = await inst.post('/get-upload-url', form, { headers: form.getHeaders() });

        const { headers } = await axios.put(up.urls[0], buffer, {
                headers: { 'content-type': 'application/octet-stream' },
                maxBodyLength: Infinity,
                maxContentLength: Infinity
        });

        const formr = new FormData();
        formr.append('name', filename || `${Date.now()}_wily.bin`);
        formr.append('user', '');
        formr.append('uploadId', up.uploadId);
        formr.append('key', up.key);
        formr.append('parts[0][PartNumber]', up.numberParts);
        formr.append('parts[0][ETag]', headers['etag']);
        const { data: b } = await inst.post('/complete-upload', formr, { headers: formr.getHeaders() });

        if (!b?.hash) throw new Error('vikingfile upload failed.');
        return `https://vikingfile.com/f/${b.hash}`;
}

const PROVIDERS = { catbox, imgbb, ornzora, vikingfile };

/**
 * Upload buffer ke provider tertentu (default: catbox).
 * Kalau gagal, otomatis fallback ke provider lain biar tetap dapet URL.
 */
export async function uploadFile(buffer, { provider = 'catbox', filename } = {}) {
        const order = [provider, ...Object.keys(PROVIDERS).filter((p) => p !== provider)];
        const errors = [];
        for (const name of order) {
                const fn = PROVIDERS[name];
                if (!fn) continue;
                try {
                        const url = await fn(buffer, filename);
                        return { provider: name, url };
                } catch (e) {
                        errors.push(`${name}: ${e.message}`);
                }
        }
        throw new Error(`Semua provider gagal:\n- ${errors.join('\n- ')}`);
}

export default { catbox, imgbb, ornzora, vikingfile, uploadFile };
