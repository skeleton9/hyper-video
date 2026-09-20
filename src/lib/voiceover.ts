import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
	applyVoiceAndCaptions,
	estimateCuesFromText,
	groupCaptionCues,
	renderVoiceMarkup,
	roundTime,
	sanitizeNarration,
	type CaptionCue,
} from './captions.ts';
import { synthesizeDoubaoTts, type TtsWord } from './doubao-tts.ts';
import { runCommand } from './hyperframes.ts';
import { mediaUrl, projectDir } from './paths.ts';
import { readProject, updateProject } from './projects.ts';
import { previewUrl, PREVIEW_LINE, resolveSpeaker, safeVoiceFile, VOICES_ROOT } from './voices.ts';

const AUDIO_REL = 'audio/voiceover.mp3';
const CAPTIONS_REL = 'captions.json';

export interface CaptionLedger {
	text: string;
	duration: number;
	speaker: string;
	resourceId: string;
	cues: CaptionCue[];
	words: TtsWord[];
}

export interface VoiceoverResult {
	audioPath: string;
	captionsPath: string;
	voiceUrl: string;
	duration: number;
	compositionDuration: number;
	captionCount: number;
	speaker: string;
	patchedHtml: boolean;
	reused: boolean;
}

async function probeDuration(filePath: string, fallback: number): Promise<number> {
	try {
		const result = await runCommand(
			'ffprobe',
			[
				'-v',
				'error',
				'-show_entries',
				'format=duration',
				'-of',
				'default=noprint_wrappers=1:nokey=1',
				filePath,
			],
			{ cwd: path.dirname(filePath), timeoutMs: 15_000 },
		);
		const parsed = Number(result.stdout.trim());
		if (result.ok && Number.isFinite(parsed) && parsed > 0) return roundTime(parsed);
	} catch {
		/* ffprobe missing */
	}
	return roundTime(fallback);
}

async function readLedger(filePath: string): Promise<CaptionLedger | undefined> {
	try {
		return JSON.parse(await readFile(filePath, 'utf8')) as CaptionLedger;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw error;
	}
}

export async function generateVoiceover(
	id: string,
	input: {
		text: string;
		speaker?: string;
		speechRate?: number;
		emotion?: string;
		captions?: boolean;
		force?: boolean;
		audioStart?: number;
	},
): Promise<VoiceoverResult> {
	const text = sanitizeNarration(input.text.replace(/\s+/g, ' ').trim());
	if (!text) throw new Error('Voiceover text is empty.');

	const dir = projectDir(id);
	const audioPath = path.join(dir, AUDIO_REL);
	const captionsPath = path.join(dir, CAPTIONS_REL);
	await mkdir(path.dirname(audioPath), { recursive: true });

	const project = await readProject(id);
	const wanted = resolveSpeaker(input.speaker || project?.speaker);
	const existing = await readLedger(captionsPath);
	let reused = false;
	let speaker = existing?.speaker ?? '';
	let resourceId = existing?.resourceId ?? '';
	let words: TtsWord[] = existing?.words ?? [];
	let duration = existing?.duration ?? 0;

	const canReuse =
		!input.force &&
		existing?.text === text &&
		existing.speaker === wanted.id &&
		(await readFile(audioPath).then(
			() => true,
			() => false,
		));

	if (canReuse && existing) {
		reused = true;
		duration = await probeDuration(audioPath, existing.duration);
	} else {
		const synthesized = await synthesizeDoubaoTts({
			text,
			speaker: wanted.id,
			resourceId: wanted.resourceId,
			speechRate: input.speechRate,
			emotion: input.emotion,
		});
		await writeFile(audioPath, synthesized.audio);
		words = synthesized.words;
		speaker = synthesized.speaker;
		resourceId = synthesized.resourceId;
		const lastWord = words[words.length - 1]?.endTime ?? 0;
		duration = await probeDuration(audioPath, lastWord || Math.max(2, text.length * 0.18));
	}

	const includeCaptions = input.captions !== false;
	const grouped = includeCaptions ? groupCaptionCues(words, duration) : [];
	const cues = includeCaptions
		? grouped.length
			? grouped
			: estimateCuesFromText(text, duration)
		: [];
	const start = roundTime(input.audioStart ?? 0);
	const requestedDuration = roundTime(start + duration + 0.35);

	const ledger: CaptionLedger = {
		text,
		duration,
		speaker,
		resourceId,
		cues,
		words,
	};
	await writeFile(captionsPath, `${JSON.stringify(ledger, null, 2)}\n`);

	let patchedHtml = false;
	let compositionDuration = requestedDuration;
	try {
		const htmlPath = path.join(dir, 'index.html');
		const html = await readFile(htmlPath, 'utf8');
		const markup = renderVoiceMarkup({
			audioSrc: `${AUDIO_REL}?t=${Date.now()}`,
			audioDuration: duration,
			audioStart: start,
			cues,
		});
		const patched = applyVoiceAndCaptions(html, markup, requestedDuration);
		await writeFile(htmlPath, patched.html);
		compositionDuration = patched.duration;
		patchedHtml = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}

	return {
		audioPath: AUDIO_REL,
		captionsPath: CAPTIONS_REL,
		voiceUrl: mediaUrl(id, AUDIO_REL),
		duration,
		compositionDuration,
		captionCount: cues.length,
		speaker,
		patchedHtml,
		reused,
	};
}

export async function previewVoice(
	speaker: string,
	force = false,
): Promise<{ speaker: string; label: string; url: string }> {
	const voice = resolveSpeaker(speaker);
	await mkdir(VOICES_ROOT, { recursive: true });
	const filePath = path.join(VOICES_ROOT, safeVoiceFile(voice.id));
	if (!force) {
		try {
			const info = await stat(filePath);
			if (info.size > 32) {
				return { speaker: voice.id, label: voice.label, url: previewUrl(voice.id, Math.round(info.mtimeMs)) };
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}

	const result = await synthesizeDoubaoTts({
		text: PREVIEW_LINE,
		speaker: voice.id,
		resourceId: voice.resourceId,
	});
	await writeFile(filePath, result.audio);
	const info = await stat(filePath);
	return { speaker: voice.id, label: voice.label, url: previewUrl(voice.id, Math.round(info.mtimeMs)) };
}

export async function applyProjectVoice(id: string, speaker?: string) {
	const project = await readProject(id);
	const wanted = resolveSpeaker(speaker || project?.speaker);
	await updateProject(id, { speaker: wanted.id });
	const existing = await readLedger(path.join(projectDir(id), CAPTIONS_REL));
	if (!existing?.text?.trim()) {
		throw new Error('还没有口播。先在对话里生成配音，再点「使用」替换音色。');
	}
	const result = await generateVoiceover(id, {
		text: existing.text,
		speaker: wanted.id,
		force: true,
		captions: true,
	});
	const next = await updateProject(id, {
		speaker: result.speaker,
		duration: result.compositionDuration,
		voiceUrl: `${result.voiceUrl}${result.voiceUrl.includes('?') ? '&' : '?'}t=${Date.now()}`,
		captionCount: result.captionCount,
		error: undefined,
		status: project?.status === 'exported' ? 'preview-ready' : (project?.status ?? 'preview-ready'),
	});
	return { project: next, applied: true as const, result };
}
