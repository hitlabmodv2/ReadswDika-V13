/**
 * Button class — interactive WhatsApp messages (Nixel v2.0)
 * Adapted untuk wily-bot: import socketon (fork baileys) via createRequire.
 */
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const { generateWAMessageFromContent, prepareWAMessageMedia } = _require('socketon');

class Button {
        constructor() {
                this._title = '';
                this._subtitle = '';
                this._body = '';
                this._footer = '';
                this._beton = [];
                this._data = undefined;
                this._contextInfo = {};
                this._currentSelectionIndex = -1;
                this._currentSectionIndex = -1;
                this._type = 0;
                this._betonOld = [];
                this._params = {};
        }

        setVideo(path, options = {}) {
                if (!path) return new Error('Url or buffer needed');
                this._data = Buffer.isBuffer(path)
                        ? { video: path, ...options }
                        : { video: { url: path }, ...options };
                return this;
        }

        setImage(path, options = {}) {
                if (!path) return new Error('Url or buffer needed');
                this._data = Buffer.isBuffer(path)
                        ? { image: path, ...options }
                        : { image: { url: path }, ...options };
                return this;
        }

        setDocument(path, options = {}) {
                if (!path) return new Error('Url or buffer needed');
                this._data = Buffer.isBuffer(path)
                        ? { document: path, ...options }
                        : { document: { url: path }, ...options };
                return this;
        }

        setMedia(obj) {
                if (typeof obj === 'object' && !Array.isArray(obj)) {
                        this._data = obj;
                } else {
                        return 'Type of media must be an Object';
                }
                return this;
        }

        setTitle(title) { this._title = title; return this; }
        setSubtitle(subtitle) { this._subtitle = subtitle; return this; }
        setBody(body) { this._body = body; return this; }
        setFooter(footer) { this._footer = footer; return this; }

        setContextInfo(obj) {
                if (typeof obj === 'object' && !Array.isArray(obj)) this._contextInfo = obj;
                else return 'Type of contextInfo must be an Object';
                return this;
        }

        setParams(obj) {
                if (typeof obj === 'object' && !Array.isArray(obj)) this._params = obj;
                else return 'Type of params must be an Object';
                return this;
        }

        setVariabel(name, value) {
                if (!Object.prototype.hasOwnProperty.call(this, name)) return `Cannot find variabel ${name}, try getVariabelList()`;
                this[name] = value;
                return this;
        }

        getVariabel(name) {
                if (!Object.prototype.hasOwnProperty.call(this, name)) return `Cannot find variabel ${name}, try getVariabelList()`;
                return this[name];
        }

        getVariabelList() { return Object.keys(this); }

        setButton(name, params) {
                this._beton.push({ name, buttonParamsJson: JSON.stringify(params) });
                return this;
        }

        setButtonV2(params) { this._betonOld.push(params); return this; }

        makeRow(header = '', title = '', description = '', id = '') {
                if (this._currentSelectionIndex === -1 || this._currentSectionIndex === -1) {
                        throw new Error('You need to create a selection and a section first');
                }
                const buttonParams = JSON.parse(this._beton[this._currentSelectionIndex].buttonParamsJson);
                buttonParams.sections[this._currentSectionIndex].rows.push({ header, title, description, id });
                this._beton[this._currentSelectionIndex].buttonParamsJson = JSON.stringify(buttonParams);
                return this;
        }

        makeSections(title = '', highlight_label = '') {
                if (this._currentSelectionIndex === -1) throw new Error('You need to create a selection first');
                const buttonParams = JSON.parse(this._beton[this._currentSelectionIndex].buttonParamsJson);
                buttonParams.sections.push({ title, highlight_label, rows: [] });
                this._currentSectionIndex = buttonParams.sections.length - 1;
                this._beton[this._currentSelectionIndex].buttonParamsJson = JSON.stringify(buttonParams);
                return this;
        }

        addSelection(title) {
                this._beton.push({ name: 'single_select', buttonParamsJson: JSON.stringify({ title, sections: [] }) });
                this._currentSelectionIndex = this._beton.length - 1;
                this._currentSectionIndex = -1;
                return this;
        }

        addReply(display_text = '', id = '') {
                this._beton.push({ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text, id }) });
                return this;
        }

        addReplyV2(displayText = 'Nixel', buttonId = 'Nixel') {
                this._betonOld.push({ buttonId, buttonText: { displayText }, type: 1 });
                this._type = 1;
                return this;
        }

        addCall(display_text = '', id = '') {
                this._beton.push({ name: 'cta_call', buttonParamsJson: JSON.stringify({ display_text, id }) });
                return this;
        }

        addReminder(display_text = '', id = '') {
                this._beton.push({ name: 'cta_reminder', buttonParamsJson: JSON.stringify({ display_text, id }) });
                return this;
        }

        addCancelReminder(display_text = '', id = '') {
                this._beton.push({ name: 'cta_cancel_reminder', buttonParamsJson: JSON.stringify({ display_text, id }) });
                return this;
        }

        addAddress(display_text = '', id = '') {
                this._beton.push({ name: 'address_message', buttonParamsJson: JSON.stringify({ display_text, id }) });
                return this;
        }

        addLocation() {
                this._beton.push({ name: 'send_location', buttonParamsJson: '' });
                return this;
        }

        addUrl(display_text = '', url = '', webview_interaction = false) {
                this._beton.push({ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text, url, webview_interaction }) });
                return this;
        }

        addCopy(display_text = '', copy_code = '', id = '') {
                this._beton.push({ name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text, copy_code, id }) });
                return this;
        }

        paramsList() {
                return {
                        limited_time_offer: { text: 'string', url: 'string', copy_code: 'string', expiration_time: 'number' },
                        bottom_sheet: { in_thread_buttons_limit: 'number', divider_indices: ['number'], list_title: 'string', button_title: 'string' },
                        tap_target_configuration: { title: 'string', description: 'string', canonical_url: 'string', domain: 'string', buttonIndex: 'number' },
                };
        }

        async run(jid, conn, quoted = '', options = {}) {
                if (this._type === 0) {
                        const message = {
                                body: { text: this._body },
                                footer: { text: this._footer },
                                header: {
                                        title: this._title,
                                        subtitle: this._subtitle,
                                        hasMediaAttachment: !!this._data,
                                        ...(this._data ? await prepareWAMessageMedia(this._data, { upload: conn.waUploadToServer }) : {}),
                                },
                        };

                        const msg = generateWAMessageFromContent(jid, {
                                interactiveMessage: {
                                        ...message,
                                        contextInfo: this._contextInfo,
                                        nativeFlowMessage: {
                                                messageParamsJson: JSON.stringify(this._params),
                                                buttons: this._beton,
                                        },
                                },
                        }, { quoted });

                        await conn.relayMessage(msg.key.remoteJid, msg.message, {
                                messageId: msg.key.id,
                                additionalNodes: [{
                                        tag: 'biz',
                                        attrs: {},
                                        content: [{
                                                tag: 'interactive',
                                                attrs: { type: 'native_flow', v: '1' },
                                                content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
                                        }],
                                }],
                                ...options,
                        });
                        return msg;
                } else {
                        return await conn.sendMessage(jid, {
                                ...(this._data ? this._data : {}),
                                [this._data ? 'caption' : 'text']: this._body,
                                title: (!!this._data ? null : this._title),
                                footer: this._footer,
                                viewOnce: true,
                                contextInfo: this._contextInfo,
                                buttons: [
                                        ...this._betonOld,
                                        ...this._beton.map((nixel) => ({
                                                buttonId: 'Nixel',
                                                buttonText: { displayText: 'Nixel' },
                                                type: 1,
                                                nativeFlowInfo: { name: nixel.name, paramsJson: nixel.buttonParamsJson },
                                        })),
                                ],
                        }, { quoted });
                }
        }
}

export default Button;
export { Button };
