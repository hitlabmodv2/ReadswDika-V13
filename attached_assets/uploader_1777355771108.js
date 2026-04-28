import axios from 'axios';
import FormData from 'form-data';
import crypto from 'crypto';

export async function catbox(image) {
    try {
        if (!Buffer.isBuffer(image)) throw new Error('Image must be a buffer.');
        
        const form = new FormData();
        form.append('userhash', '');
        form.append('reqtype', 'fileupload');
        form.append('reqtype', 'fileupload');
        form.append('userhash', '');
        form.append('fileToUpload', image, `${Date.now()}_nix.jpg`);
        
        const { headers } = await axios.get('https://catbox.moe/');
        const { data } = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: {
                ...form.getHeaders(),
                cookie: headers['set-cookie'].join('; '),
                origin: 'https://catbox.moe',
                referer: 'https://catbox.moe/',
                'user-agent': 'Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36',
                'x-requested-with': 'XMLHttpRequest'
            }
        });
        
        return data;
    } catch (error) {
        throw new Error(error.message);
    }
}

export async function vikingfile(image) {
    try {
        if (!Buffer.isBuffer(image)) throw new Error('Image must be a buffer.');
        
        const inst = axios.create({
            baseURL: 'https://vikingfile.com/api',
            headers: {
                origin: 'https://vikingfile.com',
                referer: 'https://vikingfile.com/',
                'user-agent': 'Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36'
            }
        });
        
        const form = new FormData();
        form.append('size', image.length);
        const { data: up } = await inst.post('/get-upload-url', form, {
            headers: form.getHeaders()
        });
        
        const { headers } = await axios.put(up.urls[0], image, {
            headers: {
                'content-type': 'image/jpeg'
            }
        });
        
        const formr = new FormData();
        formr.append('name', `${Date.now()}`);
        formr.append('user', '');
        formr.append('uploadId', up.uploadId);
        formr.append('key', up.key);
        formr.append('parts[0][PartNumber]', up.numberParts);
        formr.append('parts[0][ETag]', headers['etag']);
        const { data: b } = await inst.post('/complete-upload', formr, {
            headers: formr.getHeaders()
        });
        
        const { data: cf } = await axios.post('https://rynekoo-cf.hf.space/action', {
            url: `https://vik1ngfile.site/f/${b.hash}`,
            siteKey: '0x4AAAAAAAgbsMNBuk2d3Qp6',
            mode: 'turnstile-min'
        });
        
        if (!cf?.data?.token) throw new Error('Failed to get cf token.');
        
        const { data } = await axios.post(`https://vik1ngfile.site/f/${b.hash}`, new URLSearchParams({
            'cf-turnstile-response': cf.data.token,
            'ipv4': [10, crypto.randomInt(256), crypto.randomInt(256), crypto.randomInt(256)].join('.'),
            'ipv6': ''
        }).toString(), {
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                origin: 'https://vik1ngfile.site',
                'user-agent': 'Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36'
            }
        });
        
        return data;
    } catch (error) {
        throw new Error(error.message);
    }
}

export async function imgbb(image) {
    try {
        if (!Buffer.isBuffer(image)) throw new Error('Image must be a buffer.');
        
        const { data: html, headers } = await axios.get('https://imgbb.com/');
        const token = html.match(/auth_token\s*=\s*["']([a-f0-9]+)["']/)?.[1];
        if (!token) throw new Error('Failed to extract auth_token.');
        
        const form = new FormData();
        form.append('source', image, `${Date.now()}_rynn.jpg`);
        form.append('type', 'file');
        form.append('action', 'upload');
        form.append('timestamp', Date.now().toString());
        form.append('auth_token', token);
        const { data } = await axios.post('https://imgbb.com/json', form, {
            headers: {
                ...form.getHeaders(),
                cookie: headers['set-cookie'].join('; '),
                origin: 'https://imgbb.com',
                referer: 'https://imgbb.com/',
                'user-agent': 'Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36'
            }
        });
        
        return data.image.image;
    } catch (error) {
        throw new Error(error.message);
    }
}

export async function ornzora(buffer, filename = "NIXEL") {
  const form = new FormData();
  form.append('file', buffer, { filename });

  try {
    const response = await axios.post('https://cdn.ornzora.eu.cc/upload', form, {
      headers: { ...form.getHeaders() }
    });
    return response.data;
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}