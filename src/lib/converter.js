/**
 * Audio converter utilities (PTT / OPUS) memakai fluent-ffmpeg.
 * Dipakai oleh fitur Fiora untuk SPEECH/TTS dan voice note.
 */
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';

/**
 * Convert any audio buffer ke OGG/OPUS (mono, 48kHz) supaya bisa dikirim
 * sebagai voice note (ptt) di WhatsApp.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
export async function toPTT(buffer) {
        return await new Promise((resolve, reject) => {
                const input = new PassThrough();
                input.end(buffer);
                const chunks = [];
                ffmpeg(input)
                        .audioCodec('libopus')
                        .audioChannels(1)
                        .audioFrequency(48000)
                        .audioBitrate('64k')
                        .format('ogg')
                        .on('error', reject)
                        .pipe()
                        .on('data', (c) => chunks.push(c))
                        .on('end', () => resolve(Buffer.concat(chunks)))
                        .on('error', reject);
        });
}

/**
 * Convert audio buffer ke MP3 (kalau dibutuhkan).
 */
export async function toMp3(buffer) {
        return await new Promise((resolve, reject) => {
                const input = new PassThrough();
                input.end(buffer);
                const chunks = [];
                ffmpeg(input)
                        .audioCodec('libmp3lame')
                        .audioChannels(2)
                        .audioFrequency(44100)
                        .format('mp3')
                        .on('error', reject)
                        .pipe()
                        .on('data', (c) => chunks.push(c))
                        .on('end', () => resolve(Buffer.concat(chunks)))
                        .on('error', reject);
        });
}
