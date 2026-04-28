import axios from "axios";
import crypto from "crypto";
import * as cheerio from 'cheerio';
import FormData from 'form-data';
import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';
import sharp from 'sharp';

export class SpotDown {
    constructor() {
        this.inst = axios.create({
            baseURL: 'https://spotdown.org/api',
            headers: {
                origin: 'https://spotdown.org',
                referer: 'https://spotdown.org/',
                'user-agent': 'Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36'
            }
        });
        
        this.initialize = false;
        
        this.inst.interceptors.response.use(res => {
            const cookies = res.headers['set-cookie'];
            if (cookies?.length) this.inst.defaults.headers.common['cookie'] = cookies.map(c => c.split(';')[0]).join('; ');
            return res;
        });
    }
    
    async getToken() {
        try {
            const { data: cf } = await axios.post('https://rynekoo-cf.hf.space/action', {
                url: 'https://spotdown.org/',
                siteKey: '0x4AAAAAACrWMhU5hqsstO80',
                mode: 'turnstile-min'
            });
            
            if (!cf?.data?.token) throw new Error('Failed to get cf token.');
            
            const { data } = await this.inst.post('/issue-nonce', {
                cfToken: cf.data.token
            });
            
            if (!data?.token) throw new Error('Failed to get token.');
            
            this.initialize = true;
            this.inst.defaults.headers.common['x-session-token'] = data.token;
            
            return data;
        } catch (error) {
            throw new Error(error.message);
        }
    }
    
    search = async function (query) {
        try {
            if (!query) throw new Error('Query is required.');
            if (!this.initialize) await this.getToken();
            
            const { data } = await this.inst.get('/song-details', {
                params: {
                    url: query
                }
            });
            
            if (!data.songs || data.songs.length < 0) throw new Error('No result found.');
            return data.songs;
        } catch (error) {
            throw new Error(error.message);
        }
    }
    
    download = async function (url) {
        try {
            if (!url.includes('open.spotify.com')) throw new Error('Invalid url.');
            if (!this.initialize) await this.getToken();
            
            let [song, { data }] = await Promise.all([
                this.search(url),
                this.inst.post('/download', {
                    url: url
                }, {
                    responseType: 'arraybuffer'
                })
            ])
            
            return {
                metadata: {
                    title: song[0].title,
                    artist: song[0].artist,
                    duration: song[0].duration,
                    cover: song[0].thumbnail,
                    url: url
                },
                audio_buffer: Buffer.from(data)
            };
        } catch (error) {
            throw new Error(error.message);
        }
    }
}

export async function pins(query) {
  const link = `https://id.pinterest.com/resource/BaseSearchResource/get/?source_url=%2Fsearch%2Fpins%2F%3Fq%3D${encodeURIComponent(query)}%26rs%3Dtyped&data=%7B%22options%22%3A%7B%22applied_unified_filters%22%3Anull%2C%22appliedProductFilters%22%3A%22---%22%2C%22article%22%3Anull%2C%22auto_correction_disabled%22%3Afalse%2C%22corpus%22%3Anull%2C%22customized_rerank_type%22%3Anull%2C%22domains%22%3Anull%2C%22dynamicPageSizeExpGroup%22%3A%22control%22%2C%22filters%22%3Anull%2C%22journey_depth%22%3Anull%2C%22page_size%22%3Anull%2C%22price_max%22%3Anull%2C%22price_min%22%3Anull%2C%22query_pin_sigs%22%3Anull%2C%22query%22%3A%22${encodeURIComponent(query)}%22%2C%22redux_normalize_feed%22%3Atrue%2C%22request_params%22%3Anull%2C%22rs%22%3A%22typed%22%2C%22scope%22%3A%22pins%22%2C%22selected_one_bar_modules%22%3Anull%2C%22seoDrawerEnabled%22%3Afalse%2C%22source_id%22%3Anull%2C%22source_module_id%22%3Anull%2C%22source_url%22%3A%22%2Fsearch%2Fpins%2F%3Fq%3D${encodeURIComponent(query)}%26rs%3Dtyped%22%2C%22top_pin_id%22%3Anull%2C%22top_pin_ids%22%3Anull%7D%2C%22context%22%3A%7B%7D%7D`;

  const headers = {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'priority': 'u=1, i',
    'referer': 'https://id.pinterest.com/',
    'screen-dpr': '1',
    'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133")',
    'sec-ch-ua-full-version-list': '"Not(A:Brand";v="99.0.0.0", "Google Chrome";v="133.0.6943.142", "Chromium";v="133.0.6943.142")',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-platform-version': '"10.0.0"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'x-app-version': 'c056fb7',
    'x-pinterest-appstate': 'active',
    'x-pinterest-pws-handler': 'www/index.js',
    'x-pinterest-source-url': '/',
    'x-requested-with': 'XMLHttpRequest'
  };

  try {
    const res = await axios.get(link, { headers });
    if (res.data?.resource_response?.data?.results) {
      return res.data
      ?.resource_response?.data?.results
	?.filter(item => item?.images?.orig?.url)
	?.map(v => ({
		username: v.board.owner.username, 
		title: v?.title,
		description: v?.description,
		image_url: v?.images?.orig?.url
	})) || [];
    }
  } catch (error) {
    console.error('Error:', error);
    return [];
  }
};

export async function youtubeSearch(query) {
    try {
        const { data } = await axios.request({
            baseURL: "https://youtube.com",
            url: "/results",
            params: { search_query: query }
        }).catch((e) => e?.response);

        const $ = cheerio.load(data);
        let _string = "";

        $("script").each((i, e) => {
            if (/var ytInitialData = /gi.exec($(e).html())) {
                _string += $(e).html()
                    .replace(/var ytInitialData = /i, "")
                    .replace(/;$/, "");
            }
        });

        const _initData = JSON.parse(_string)
            .contents.twoColumnSearchResultsRenderer.primaryContents;

        const Results = [];
        let _render = null;

        if (_initData.sectionListRenderer) {
            _render = _initData.sectionListRenderer.contents
                .filter(item =>
                    item?.itemSectionRenderer?.contents.filter(v =>
                        v.videoRenderer || v.playlistRenderer || v.channelRenderer
                    )
                )
                .shift().itemSectionRenderer.contents;
        }

        if (_initData.richGridRenderer) {
            _render = _initData.richGridRenderer.contents
                .filter(item =>
                    item.richGridRenderer && item.richGridRenderer.contents
                )
                .map(item => item.richGridRenderer.contents);
        }

        for (const item of _render) {
            if (item.videoRenderer && item.videoRenderer.lengthText) {
                const video = item.videoRenderer;

                const title = video?.title?.runs[0]?.text || "";
                const duration = video?.lengthText?.simpleText || "";
                const thumbnail = video?.thumbnail?.thumbnails[
                    video?.thumbnail?.thumbnails.length - 1
                ].url || "";
                const uploaded = video?.publishedTimeText?.simpleText || "";
                const views = video?.viewCountText?.simpleText
                    ?.replace(/[^0-9.]/g, "") || "";

                if (title && thumbnail && duration && uploaded && views) {
                    Results.push({
                        title,
                        thumbnail,
                        duration,
                        uploaded,
                        views,
                        url: "https://www.youtube.com/watch?v=" + video.videoId
                    });
                }
            }
        }

        return Results;
    } catch (e) {
        return {
            error: true,
            message: String(e)
        };
    }
}

export async function lyricsSearch(keyword) {
    if (!keyword) throw new Error("Keyword pencarian wajib diisi.");
    
    const TARGET_URL = 'https://lrclib.net/api/search';
    const HEADERS = {
    'User-Agent': 'LRCLIB Web Client (https://github.com/tranxuanthang/lrclib)',
    'X-User-Agent': 'LRCLIB Web Client (https://github.com/tranxuanthang/lrclib)',
    'Lrclib-Client': 'LRCLIB Web Client (https://github.com/tranxuanthang/lrclib)',
    'Accept': 'application/json, text/plain, */*'
};

    try {
        const response = await axios.get(TARGET_URL, {
            headers: HEADERS,
            params: {
                q: keyword
            }
        });

        const data = response.data;

        if (Array.isArray(data) && data.length > 0) {
            return data.map(item => ({
                id: item.id,
                track: item.trackName,
                artist: item.artistName,
                album: item.albumName,
                duration: item.duration,
                instrumental: item.instrumental,
                plainLyrics: item.plainLyrics,
                syncedLyrics: item.syncedLyrics
            }));
        } else {
            return [];
        }

    } catch (error) {
        if (error.response) {
            throw new Error(`Lyrics API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        }
        throw new Error(`Lyrics Error: ${error.message}`);
    }
}

export async function googleSearch(query, maxResults = 50) {
  const GOOGLE_API_KEY = 'AIzaSyDN4XveMYQrF5YGSqgupHwg4Yhg09iT7Gg';
  const SEARCH_ENGINE_ID = 'd02711e8677af48e9';
  try {
    let allResults = [];
    let currentIndex = 1;
    while (allResults.length < maxResults) {
      const { data } = await axios.get(
        'https://www.googleapis.com/customsearch/v1',
        {
          params: {
            key: GOOGLE_API_KEY,
            cx: SEARCH_ENGINE_ID,
            q: query,
            start: currentIndex,
            num: 10
          }
        }
      );
      if (data.error) {
        throw new Error(data.error.message);
      }
      if (!data.items || data.items.length === 0) break;
      const formatted = data.items.map(item => ({
        title: item.title,
        url: item.link,
        desc: item.snippet,
        icon: item.pagemap?.cse_image?.[0]?.src || ''
      }));
      allResults.push(...formatted);
      if (!data.queries?.nextPage) break;
      currentIndex += 10;
    }
    return { status: 200, error: false, data: allResults };
  } catch (err) {
    return { status: 500, error: true, data: err.message };
  }
}

export async function gptimage({ prompt, image, model = 'gpt-image-1.5' } = {}) {
    try {
        const models = ['gpt-image-1', 'gpt-image-1.5'];
        
        if (!prompt) throw new Error('Prompt is required.');
        if (!Buffer.isBuffer(image)) throw new Error('Image must be a buffer.');
        if (!models.includes(model)) throw new Error(`Available models: ${models.join(', ')}.`);
        
        const { data } = await axios.post('https://ghibli-proxy.netlify.app/.netlify/functions/ghibli-proxy', {
            image: 'data:image/png;base64,' + image.toString('base64'),
            prompt: prompt,
            model: model,
            n: 1,
            size: 'auto',
            quality: 'low'
        }, {
            headers: {
                origin: 'https://overchat.ai',
                referer: 'https://overchat.ai/',
                'user-agent': 'Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36'
            }
        });
        
        const result = data?.data?.[0]?.b64_json;
        if (!result) throw new Error('No result found.');
        
        return Buffer.from(result, 'base64');
    } catch (error) {
        throw new Error(error.message);
    }
}

export async function aiorapidapi(url) {
    try {
        if (!url.startsWith('https://')) throw new Error('Invalid URL.');
        
        const { data } = await axios.post('https://auto-download-all-in-one.p.rapidapi.com/v1/social/autolink', {
            url: url
        }, {
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.63 Safari/537.36 OPR/78.0.4093.184',
                'x-rapidapi-host': 'auto-download-all-in-one.p.rapidapi.com',
                'x-rapidapi-key': 'ca5c6d6fa3mshfcd2b0a0feac6b7p140e57jsn72684628152a'
            }
        });
        
        return data;
    } catch (error) {
        throw new Error(error.message);
    }
}

export class Gemini {
    constructor() { 
        this.authToken = null;
        this.tokenExpiry = null;
    }
    
    async getAuthToken() {
        try {
            if (this.authToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) return this.authToken;
            
            const { data } = await axios.post('https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=AIzaSyAxof8_SbpDcww38NEQRhNh0Pzvbphh-IQ', {
                clientType: 'CLIENT_TYPE_ANDROID'
            }, {
                headers: {
                    'accept-encoding': 'gzip',
                    'accept-language': 'in-ID, en-US',
                    'connection': 'Keep-Alive',
                    'content-type': 'application/json',
                    'user-agent': 'Dalvik/2.1.0 (Linux; U; Android 10; SM-J700F Build/QQ3A.200805.001)',
                    'x-android-cert': '037CD2976D308B4EFD63EC63C48DC6E7AB7E5AF2',
                    'x-android-package': 'com.jetkite.gemmy',
                    'x-client-version': 'Android/Fallback/X24000001/FirebaseCore-Android',
                    'x-firebase-appcheck': 'eyJlcnJvciI6IlVOS05PV05fRVJST1IifQ==',
                    'x-firebase-client': 'H4sIAAAAAAAAAKtWykhNLCpJSk0sKVayio7VUSpLLSrOzM9TslIyUqoFAFyivEQfAAAA',
                    'x-firebase-gmpid': '1:652803432695:android:c4341db6033e62814f33f2',
                }
            });
            
            if (!data.idToken) throw new Error('Failed to get Gemini auth token.');
            this.authToken = data.idToken;
            this.tokenExpiry = Date.now() + 3600 * 1000;
            
            return this.authToken;
        } catch (error) {
            throw new Error(error.message);
        }
    }
    
    async chat({ contents, model = 'gemini-flash-latest', ...config }) {
        try {
            if (!Array.isArray(contents)) throw new Error('Contents must be a array.');
            const authToken = await this.getAuthToken();
            
            const { data } = await axios.post('https://asia-northeast3-gemmy-ai-bdc03.cloudfunctions.net/gemini', {
                model,
                stream: false,
                request: {
                    contents: contents,
                    generationConfig: {
                        maxOutputTokens: 8192,
                        ...config
                    }
                }
            }, {
                headers: {
                    'accept-encoding': 'gzip',
                    'authorization': `Bearer ${authToken}`,
                    'content-type': 'application/json; charset=UTF-8',
                    'user-agent': 'okhttp/5.3.2',
                }
            });
            
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error('Gemini returned empty response.');
            
            return text;
        } catch (error) {
            throw new Error(error.message);
        }
    }
}

export class TurnstileSolver {
    constructor() {
        this.solverURL = "https://cf-solver-renofc.my.id/api/solvebeta";
    }

    async solve(url, siteKey, mode = "turnstile-min") {
        const response = await axios.post(this.solverURL, {
            url: url,
            siteKey: siteKey,
            mode: mode
        }, {
            headers: { "Content-Type": "application/json" }
        });
        return response.data.token.result.token;
    }
}

export class AIBanana {
    constructor() {
        this.baseURL = "https://aibanana.net";
        this.siteKey = "0x4AAAAAAB2-fh9F_EBQqG2_";
        this.solver = new TurnstileSolver();
    }

    generateFingerprint() {
        return crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
    }

    generateDeviceId() {
        return crypto.randomBytes(8).toString("hex");
    }

    generateRandomUserAgent() {
        const osList = ["Windows NT 10.0; Win64; x64", "Macintosh; Intel Mac OS X 10_15_7", "X11; Linux x86_64", "Windows NT 6.1; Win64; x64", "Windows NT 6.3; Win64; x64"];
        const os = osList[Math.floor(Math.random() * osList.length)];
        const chromeVersion = Math.floor(Math.random() * 40) + 100;
        return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Safari/537.36`;
    }

    generateRandomViewport() {
        const resolutions = [
            { w: 1366, h: 768 }, { w: 1920, h: 1080 }, { w: 1440, h: 900 },
            { w: 1536, h: 864 }, { w: 1280, h: 720 }, { w: 1600, h: 900 },
            { w: 2560, h: 1440 }, { w: 1680, h: 1050 }, { w: 1024, h: 768 }
        ];
        return resolutions[Math.floor(Math.random() * resolutions.length)];
    }

    generateRandomPlatform() {
        return ["Windows", "Linux", "macOS", "Chrome OS"][Math.floor(Math.random() * 4)];
    }

    generateRandomLanguage() {
        return ["en-US,en;q=0.9", "id-ID,id;q=0.9,en-US;q=0.8", "en-GB,en;q=0.9", "es-ES,es;q=0.9"][Math.floor(Math.random() * 4)];
    }

    async generateImage(prompt) {
        const turnstileToken = await this.solver.solve(this.baseURL, this.siteKey, "turnstile-min");
        const fingerprint = this.generateFingerprint();
        const deviceId = this.generateDeviceId();
        const userAgent = this.generateRandomUserAgent();
        const viewport = this.generateRandomViewport();
        const platform = this.generateRandomPlatform();
        const language = this.generateRandomLanguage();
        const chromeVersion = Math.floor(Math.random() * 30) + 110;

        const response = await axios.post(`${this.baseURL}/api/image-generation`, {
            prompt: prompt,
            model: "nano-banana-2",
            mode: "text-to-image",
            numImages: 1,
            aspectRatio: "1:1",
            clientFingerprint: fingerprint,
            turnstileToken: turnstileToken,
            deviceId: deviceId
        }, {
            headers: {
                "Content-Type": "application/json",
                "Accept": "*/*",
                "Accept-Language": language,
                "Origin": this.baseURL,
                "Referer": `${this.baseURL}/`,
                "User-Agent": userAgent,
                "Sec-Ch-Ua": `"Chromium";v="${chromeVersion}", "Not-A.Brand";v="24", "Google Chrome";v="${chromeVersion}"`,
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": `"${platform}"`,
                "Viewport-Width": viewport.w.toString(),
                "Viewport-Height": viewport.h.toString(),
                "X-Forwarded-For": `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
                "Cache-Control": "no-cache",
                "Pragma": "no-cache"
            }
        });

        return response.data;
    }
}

export async function getBuffer(url, options = {}) {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      ...options
    })

    return Buffer.from(res.data)
  } catch (e) {
    throw new Error(`Failed to get buffer: ${e.message}`)
  }
}

export async function webpToJpg(buffer) {
  try {
    return await sharp(buffer)
      .jpeg({ quality: 90 })
      .toBuffer()
  } catch (e) {
    throw new Error(`Convert failed: ${e.message}`)
  }
}

export async function imagy(url, { device = 'desktop', full_page = false, device_scale = 1 } = {}) {
    try {
        const devices = {
            desktop: { width: 1920, height: 1080 },
            mobile: { width: 375, height: 812 },
            tablet: { width: 768, height: 1024 }
        };
        
        if (!url.startsWith('https://')) throw new Error('Invalid URL.');
        if (!devices[device]) throw new Error(`Available devices: ${Object.keys(devices).join(', ')}.`);
        if (isNaN(device_scale)) throw new Error('Scale must be a number.');
        if (typeof full_page !== 'boolean') throw new Error('Full page must be a boolean.');
        
        const { data } = await axios.post('https://gcp.imagy.app/screenshot/createscreenshot', {
            url: url,
            browserWidth: devices[device].width,
            browserHeight: devices[device].height,
            fullPage: full_page,
            deviceScaleFactor: parseInt(device_scale),
            format: 'png'
        }, {
            headers: {
                'content-type': 'application/json',
                referer: 'https://imagy.app/full-page-screenshot-taker/',
                'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
            }
        });
        
        return data.fileUrl;
    } catch (error) {
        throw new Error(error.message);
    }
}

export async function reelsSearch(query, num = 10) {
  const cx = "e500c3a7a523b49df";

  const ins = axios.create({
    headers: {
      "user-agent":
        "Mozilla/5.0 (Linux; Android 16; SM-F966B Build) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      "x-client-data": "CJDjygE=",
    },
  });

  // ambil config CSE
  const { data: init } = await ins.get(
    "https://cse.google.com/cse.js",
    { params: { cx } }
  );

  const match = init.match(/}\)\(({[\s\S]*?})\);/);
  if (!match || !match[1]) {
    throw new Error("Gagal ambil config Google CSE");
  }

  const cfg = JSON.parse(match[1]);

  const params = {
    rsz: "filtered_cse",
    num,
    hl: "id",
    source: "gcsc",
    cselibv: cfg.cselibVersion,
    cx,
    q: query,
    safe: "off",
    cse_tok: cfg.cse_token,
    gl: "id",
    filter: 0,
    callback: "google.search.cse.api11171",
    rurl: Buffer.from(
      "aHR0cHM6Ly9yZWVsc2ZpbmRlci5zYXRpc2h5YWRhdi5jb20v",
      "base64"
    ).toString(),
  };

  const raw = await ins.get(
    "https://cse.google.com/cse/element/v1",
    { params }
  ).then(r => r.data);

  // extract JSON dari callback
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const json = JSON.parse(raw.slice(start, end + 1));

  if (!json.results) return [];

  return json.results.map(item => ({
    title: item.richSnippet?.metatags?.ogTitle || null,
    description: item.richSnippet?.metatags?.ogDescription || null,
    url: item.url,
    image: item.richSnippet?.metatags?.ogImage || null,
  }));
}