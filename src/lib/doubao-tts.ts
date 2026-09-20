import { randomUUID } from 'node:crypto';

import { resolveSpeaker } from './voices.ts';

const TTS_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const SUCCESS_END = 20_000_000;

export interface TtsWord {
	word: string;
	startTime: number;
	endTime: number;
}

export interface DoubaoTtsResult {
	audio: Buffer;
	words: TtsWord[];
	resourceId: string;
	speaker: string;
}

export interface DoubaoTtsInput {
	text: string;
	speaker?: string;
	resourceId?: string;
	speechRate?: number;
	emotion?: string;
}

function isTts2(resourceId: string): boolean {
	return resourceId.includes('2.0');
}

function defaultSpeaker(resourceId: string): string {
	const resolved = resolveSpeaker(process.env.DOUBAO_SPEAKER);
	if (isTts2(resourceId) && resolved.resourceId !== 'seed-tts-2.0') {
		return 'zh_female_vv_uranus_bigtts';
	}
	return resolved.id;
}

function defaultResource(): string {
	return process.env.DOUBAO_RESOURCE_ID?.trim() || 'seed-tts-1.0';
}

function apiKey(): string {
	const key = process.env.DOUBAO_API_KEY?.trim();
	if (!key) {
		throw new Error('Missing DOUBAO_API_KEY. Add the 语音技术 console key to .env.');
	}
	return key;
}

function clampRate(value: number | undefined): number | undefined {
	if (value === undefined || Number.isNaN(value)) return undefined;
	return Math.min(100, Math.max(-50, value));
}

function extractJsonObjects(buffer: string): { objects: unknown[]; rest: string } {
	const objects: unknown[] = [];
	let index = 0;

	while (index < buffer.length) {
		while (index < buffer.length && /\s/.test(buffer[index] ?? '')) index += 1;
		if (index >= buffer.length) break;

		if (buffer.startsWith('data:', index)) {
			const newline = buffer.indexOf('\n', index);
			if (newline === -1) return { objects, rest: buffer.slice(index) };
			const payload = buffer.slice(index + 5, newline).trim();
			index = newline + 1;
			if (payload && payload !== '[DONE]') {
				try {
					objects.push(JSON.parse(payload) as unknown);
				} catch {
					/* skip malformed SSE line */
				}
			}
			continue;
		}

		if (buffer[index] !== '{') {
			const next = buffer.indexOf('{', index);
			if (next === -1) return { objects, rest: '' };
			index = next;
		}

		let depth = 0;
		let inString = false;
		let escaped = false;
		let cursor = index;
		let closed = false;
		for (; cursor < buffer.length; cursor += 1) {
			const char = buffer[cursor] ?? '';
			if (inString) {
				if (escaped) {
					escaped = false;
					continue;
				}
				if (char === '\\') {
					escaped = true;
					continue;
				}
				if (char === '"') inString = false;
				continue;
			}
			if (char === '"') {
				inString = true;
				continue;
			}
			if (char === '{') depth += 1;
			else if (char === '}') {
				depth -= 1;
				if (depth === 0) {
					objects.push(JSON.parse(buffer.slice(index, cursor + 1)) as unknown);
					index = cursor + 1;
					closed = true;
					break;
				}
			}
		}
		if (!closed) return { objects, rest: buffer.slice(index) };
	}

	return { objects, rest: '' };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function readWords(value: unknown): TtsWord[] {
	const record = asRecord(value);
	const nested =
		asRecord(record?.sentence) ??
		asRecord(record?.subtitle) ??
		asRecord(asRecord(record?.result)?.subtitle) ??
		record;
	const words = nested?.words;
	if (!Array.isArray(words)) return [];
	const parsed: TtsWord[] = [];
	for (const item of words) {
		const word = asRecord(item);
		if (!word) continue;
		const text = String(word.word ?? word.text ?? '').trim();
		const start = Number(word.startTime ?? word.start_time ?? word.start);
		const end = Number(word.endTime ?? word.end_time ?? word.end);
		if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
		parsed.push({ word: text, startTime: start, endTime: end });
	}
	return parsed;
}

function isMismatchError(message: string): boolean {
	return /mismatch|resource id|speaker|音色|不匹配|不支持/i.test(message);
}

async function synthesizeOnce(
	input: DoubaoTtsInput,
	resourceId: string,
	speaker: string,
): Promise<DoubaoTtsResult> {
	const text = input.text.trim();
	if (!text) throw new Error('Voiceover text is empty.');

	const tts2 = isTts2(resourceId);
	const speechRate = clampRate(input.speechRate);
	const body = {
		user: { uid: 'hyper-video' },
		req_params: {
			text,
			speaker,
			audio_params: {
				format: 'mp3',
				sample_rate: 24000,
				...(speechRate !== undefined ? { speech_rate: speechRate } : {}),
				...(input.emotion?.trim() ? { emotion: input.emotion.trim() } : {}),
				...(tts2 ? { enable_subtitle: true } : { enable_timestamp: true }),
			},
			additions: JSON.stringify({
				disable_markdown_filter: true,
				silence_duration: 180,
			}),
		},
	};

	const response = await fetch(TTS_URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'X-Api-Key': apiKey(),
			'X-Api-Resource-Id': resourceId,
			'X-Api-Request-Id': randomUUID(),
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(90_000),
	});

	if (!response.ok) {
		const detail = (await response.text()).slice(0, 400);
		throw new Error(`Doubao TTS HTTP ${response.status}: ${detail || response.statusText}`);
	}

	if (!response.body) throw new Error('Doubao TTS returned an empty body.');

	const chunks: Buffer[] = [];
	const words: TtsWord[] = [];
	let buffer = '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const extracted = extractJsonObjects(buffer);
		buffer = extracted.rest;
		for (const object of extracted.objects) {
			const record = asRecord(object);
			if (!record) continue;
			const code = Number(record.code ?? 0);
			const message = String(record.message ?? '');
			if (code === SUCCESS_END) continue;
			if (code !== 0) {
				throw new Error(message || `Doubao TTS error ${code}`);
			}
			if (typeof record.data === 'string' && record.data) {
				chunks.push(Buffer.from(record.data, 'base64'));
			}
			words.push(...readWords(record));
		}
	}

	if (buffer.trim()) {
		const extracted = extractJsonObjects(buffer);
		for (const object of extracted.objects) {
			const record = asRecord(object);
			if (!record) continue;
			const code = Number(record.code ?? 0);
			if (code === SUCCESS_END || code !== 0) continue;
			if (typeof record.data === 'string' && record.data) {
				chunks.push(Buffer.from(record.data, 'base64'));
			}
			words.push(...readWords(record));
		}
	}

	const audio = Buffer.concat(chunks);
	if (audio.length < 32) throw new Error('Doubao TTS returned no audio.');
	return { audio, words, resourceId, speaker };
}

export async function synthesizeDoubaoTts(input: DoubaoTtsInput): Promise<DoubaoTtsResult> {
	const voice = resolveSpeaker(input.speaker);
	const preferred = input.resourceId?.trim() || voice.resourceId || defaultResource();
	const speaker = input.speaker?.trim() || voice.id;
	try {
		return await synthesizeOnce(input, preferred, speaker);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!isMismatchError(message)) throw error;
		const fallback = isTts2(preferred) ? 'seed-tts-1.0' : 'seed-tts-2.0';
		const fallbackSpeaker = input.speaker?.trim() || defaultSpeaker(fallback);
		return synthesizeOnce(input, fallback, fallbackSpeaker);
	}
}
