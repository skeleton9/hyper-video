import type { TtsWord } from './doubao-tts.ts';

export interface CaptionCue {
	id: string;
	start: number;
	duration: number;
	text: string;
}

const SENTENCE_MARK = /[。！？!?]/;
const CLAUSE_MARK = /[，,、；;]/;
const PUNCT_ONLY = /^[\s。！？；!?;，,、.："”''""（）()【】《》…—–―\-]+$/;
const HANGING_END = /[的了着过和与且而却也还就都把被从对向给让到得地与]$/;
const MIN_DURATION = 0.55;
const MIN_CLAUSE_WEIGHT = 8;
const MAX_WEIGHT = 20;
const HARD_WEIGHT = 24;
const MAX_SPAN = 3.0;
const HARD_SPAN = 3.6;
const MERGE_WEIGHT = 26;

export function roundTime(value: number): number {
	return Math.round(value * 1000) / 1000;
}

export function sanitizeNarration(text: string): string {
	return text
		.replace(/[—–―]+/g, '，')
		.replace(/-{2,}/g, '，')
		.replace(/，{2,}/g, '，')
		.replace(/。，/g, '。')
		.replace(/，。/g, '。')
		.replace(/^\s*，\s*/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function charWeight(text: string): number {
	let weight = 0;
	for (const char of text) {
		if (/[\u4e00-\u9fff]/.test(char)) weight += 1;
		else if (/[A-Za-z0-9]/.test(char)) weight += 0.45;
	}
	return weight;
}

function cueId(index: number): string {
	return `caption-${String(index + 1).padStart(2, '0')}`;
}

function joinWords(words: TtsWord[]): string {
	return words.map((item) => item.word).join('');
}

function isPunctToken(word: string): boolean {
	return PUNCT_ONLY.test(word.trim());
}

function tidyCaptionText(text: string): string {
	return sanitizeNarration(text).replace(/\s+/g, '');
}

function finishCaptionText(text: string): string {
	return tidyCaptionText(text).replace(/[，,、。.;；:：…]+$/g, '');
}

function letterCount(text: string): number {
	return (tidyCaptionText(text).match(/[\u4e00-\u9fffA-Za-z0-9]/g) ?? []).length;
}

function isOrphanText(text: string): boolean {
	const tidy = tidyCaptionText(text);
	if (!tidy) return true;
	const letters = letterCount(tidy);
	if (letters === 0) return true;
	if (letters <= 1 && /[。！？；!?;，,、.]/.test(tidy)) return true;
	return false;
}

function looksCut(previous: string, next: string): boolean {
	const left = tidyCaptionText(previous);
	const right = tidyCaptionText(next);
	if (!left || !right) return true;
	if (SENTENCE_MARK.test(left.slice(-1))) return false;
	if (/^[，,、。！？!?]/.test(right)) return true;
	if (CLAUSE_MARK.test(left.slice(-1))) return false;
	if (HANGING_END.test(left)) return true;
	if (charWeight(right) <= 8) return true;
	return false;
}

function nextBreakIndex(words: TtsWord[], from: number): number {
	for (let index = from; index < words.length; index += 1) {
		const token = words[index]?.word ?? '';
		if (SENTENCE_MARK.test(token) || CLAUSE_MARK.test(token)) return index;
	}
	return -1;
}

function mergeOrphanCues(cues: CaptionCue[]): CaptionCue[] {
	const merged: CaptionCue[] = [];
	for (const cue of cues) {
		const previous = merged[merged.length - 1];
		if (!previous) {
			merged.push({ ...cue, text: tidyCaptionText(cue.text) });
			continue;
		}
		const left = previous.text;
		const right = tidyCaptionText(cue.text);
		const combined = charWeight(left) + charWeight(right);
		const shouldMerge =
			isOrphanText(right) ||
			isOrphanText(left) ||
			(looksCut(left, right) && combined <= MERGE_WEIGHT);
		if (shouldMerge) {
			previous.text = tidyCaptionText(`${left}${right}`);
			previous.duration = roundTime(cue.start + cue.duration - previous.start);
			continue;
		}
		merged.push({ ...cue, text: right });
	}
	return merged.filter((cue) => cue.text && !PUNCT_ONLY.test(cue.text));
}

export function groupCaptionCues(words: TtsWord[], audioDuration?: number): CaptionCue[] {
	const usable = words
		.filter((word) => word.word.trim() && word.endTime > word.startTime)
		.sort((left, right) => left.startTime - right.startTime);
	if (usable.length === 0) return [];

	const groups: TtsWord[][] = [];
	let current: TtsWord[] = [];

	const flush = () => {
		if (current.length) groups.push(current);
		current = [];
	};

	for (let index = 0; index < usable.length; index += 1) {
		const word = usable[index]!;
		if (current.length === 0 && isPunctToken(word.word)) {
			if (groups.length) groups[groups.length - 1]!.push(word);
			continue;
		}
		current.push(word);
		const text = joinWords(current);
		const weight = charWeight(text);
		const span = word.endTime - current[0]!.startTime;
		const sentenceEnd = SENTENCE_MARK.test(word.word);
		const clauseEnd = /[，,；;]/.test(word.word);
		const restBreak = nextBreakIndex(usable, index + 1);
		const restWeight =
			restBreak === -1 ? Number.POSITIVE_INFINITY : charWeight(joinWords(usable.slice(index + 1, restBreak + 1)));

		if (sentenceEnd && weight >= 2) {
			flush();
			continue;
		}
		if (clauseEnd && weight >= MIN_CLAUSE_WEIGHT) {
			flush();
			continue;
		}
		if ((weight >= MAX_WEIGHT || span >= MAX_SPAN) && restWeight <= 3) {
			continue;
		}
		if (weight >= HARD_WEIGHT || span >= HARD_SPAN) {
			const stem = tidyCaptionText(text).replace(/[。！？；!?;，,、.："”]+$/g, '');
			if (!HANGING_END.test(stem) || weight >= HARD_WEIGHT + 4) flush();
		}
	}
	flush();

	const cues: CaptionCue[] = groups.map((group, index) => {
		const start = roundTime(group[0]!.startTime);
		const rawEnd = group[group.length - 1]!.endTime;
		return {
			id: cueId(index),
			start,
			duration: roundTime(Math.max(MIN_DURATION, rawEnd - start)),
			text: tidyCaptionText(joinWords(group)),
		};
	});

	const merged = mergeOrphanCues(cues);
	for (let index = 0; index < merged.length; index += 1) {
		merged[index]!.id = cueId(index);
	}

	for (let index = 0; index < merged.length - 1; index += 1) {
		const cue = merged[index]!;
		const next = merged[index + 1]!;
		const limit = next.start - 0.04;
		if (cue.start + cue.duration > limit) {
			cue.duration = roundTime(Math.max(0.4, limit - cue.start));
		}
	}

	const last = merged[merged.length - 1];
	if (last && audioDuration && last.start + last.duration > audioDuration) {
		last.duration = roundTime(Math.max(0.4, audioDuration - last.start));
	}

	return merged
		.map((cue) => ({ ...cue, text: finishCaptionText(cue.text) }))
		.filter((cue) => cue.text);
}

function splitSpokenClauses(text: string): string[] {
	return sanitizeNarration(text)
		.replace(/\n+/g, '')
		.split(/(?<=[。！？!?，,、；;])/)
		.map((part) => part.trim())
		.filter(Boolean);
}

function splitLongClause(clause: string, maxChars: number): string[] {
	if (charWeight(clause) <= maxChars) return [clause];
	const chars = [...clause];
	const lines: string[] = [];
	let cursor = 0;
	while (cursor < chars.length) {
		const rest = chars.length - cursor;
		if (rest <= maxChars) {
			lines.push(chars.slice(cursor).join(''));
			break;
		}
		let end = cursor + maxChars;
		const window = chars.slice(cursor, end).join('');
		const punctAt = Math.max(
			window.lastIndexOf('，'),
			window.lastIndexOf('、'),
			window.lastIndexOf('；'),
			window.lastIndexOf('。'),
			window.lastIndexOf('！'),
			window.lastIndexOf('？'),
		);
		if (punctAt >= MIN_CLAUSE_WEIGHT - 1) end = cursor + punctAt + 1;
		let slice = chars.slice(cursor, end).join('');
		const leftover = chars.length - end;
		if (leftover > 0 && leftover <= 2) end = chars.length;
		slice = chars.slice(cursor, end).join('');
		const stem = slice.replace(/[。！？!?，,、；;]+$/g, '');
		if (HANGING_END.test(stem) && end < chars.length) {
			end -= 1;
			slice = chars.slice(cursor, end).join('');
		}
		if (/^[。！？!?，,、；;]/.test(chars[end] ?? '')) {
			end += 1;
			slice = chars.slice(cursor, end).join('');
		}
		if (end <= cursor) end = Math.min(cursor + maxChars, chars.length);
		lines.push(chars.slice(cursor, end).join(''));
		cursor = end;
	}
	return lines.filter(Boolean);
}

export function wrapOnScreenCopy(text: string, maxChars = 10): string {
	const clauses = splitSpokenClauses(text);
	if (clauses.length === 0) return sanitizeNarration(text);
	const lines: string[] = [];
	let current = '';
	const push = (line: string) => {
		const tidy = line.trim();
		if (tidy) lines.push(tidy);
	};
	for (const clause of clauses) {
		const pieces = splitLongClause(clause, maxChars);
		for (const piece of pieces) {
			if (!current) {
				current = piece;
				continue;
			}
			if (charWeight(`${current}${piece}`) <= maxChars) {
				current += piece;
				continue;
			}
			push(current);
			current = piece;
		}
	}
	push(current);
	for (let index = 1; index < lines.length; index += 1) {
		const previous = lines[index - 1]!;
		const line = lines[index]!;
		if (
			charWeight(line) <= 3 &&
			!SENTENCE_MARK.test(line) &&
			!CLAUSE_MARK.test(line.slice(-1)) &&
			charWeight(`${previous}${line}`) <= maxChars + 2
		) {
			lines[index - 1] = `${previous}${line}`;
			lines.splice(index, 1);
			index -= 1;
		}
	}
	return lines.join('\n');
}

function maxCharsForCopy(tag: string, attrs: string): number {
	if (/\bcaption\b/.test(attrs)) return 18;
	if (/\btitle-sm\b|\bbig\b/.test(attrs)) return 9;
	if (/\btitle\b/.test(attrs)) return 8;
	if (/\bquote\b|\bhook-q\b|\bclosing\b/.test(attrs)) return 10;
	if (/\bkicker\b|\beyebrow\b/.test(attrs)) return 12;
	if (tag === 'h1') return 8;
	return 12;
}

export function wrapHtmlCopy(html: string): string {
	return html.replace(/<(h1|h2|h3|p|div)\b([^>]*)>([^<]*)<\/\1>/gi, (full, tag: string, attrs: string, inner: string) => {
		if (/\bcaption\b/.test(attrs) || /\bid="caption-/.test(attrs)) return full;
		if (!inner.trim()) return full;
		const wrapped = wrapOnScreenCopy(inner.replace(/\s+/g, ' ').trim(), maxCharsForCopy(tag, attrs));
		if (!wrapped || wrapped === inner.trim()) return full;
		return `<${tag}${attrs}>${escapeHtml(wrapped)}</${tag}>`;
	});
}

export function estimateCuesFromText(text: string, duration: number): CaptionCue[] {
	const source = sanitizeNarration(text);
	const parts = source
		.split(/(?<=[。！？；!?;，,、\n])/)
		.map((part) => tidyCaptionText(part))
		.filter((part) => part && !PUNCT_ONLY.test(part) && letterCount(part) > 1);
	if (parts.length === 0) return [];
	const weights = parts.map((part) => Math.max(charWeight(part), 1));
	const total = weights.reduce((sum, value) => sum + value, 0);
	let cursor = 0;
	return parts.map((part, index) => {
		const span = Math.max(MIN_DURATION, (weights[index]! / total) * duration);
		const cue: CaptionCue = {
			id: cueId(index),
			start: roundTime(cursor),
			duration: roundTime(span),
			text: finishCaptionText(part),
		};
		cursor += span;
		return cue;
	});
}

export function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

const CAPTION_CSS = `
      .caption-rail {
        position: absolute;
        left: 4%;
        right: 4%;
        bottom: 8%;
        display: flex;
        justify-content: center;
        pointer-events: none;
      }
      .caption {
        display: inline-block;
        max-width: 100%;
        margin: 0;
        padding: 14px 24px;
        border-radius: 10px;
        background: rgba(8, 10, 14, 0.62);
        font-size: 40px;
        line-height: 1.35;
        letter-spacing: 0.03em;
        text-align: center;
        color: #f7f2e8;
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
        line-break: strict;
        white-space: pre-line;
      }
      h1, h2, h3, p, .title, .title-sm, .line, .line-dim, .sub, .big, .step, .hook-q, .quote, .kicker, .closing, .foot {
        line-break: strict;
        overflow-wrap: break-word;
        white-space: pre-line;
      }
`;

function updateRootDuration(html: string, duration: number): { html: string; previous: number } {
	const match = html.match(/<div\b[^>]*\bid="root"[^>]*>/i);
	if (!match || match.index === undefined) {
		throw new Error('index.html is missing #root.');
	}
	const tag = match[0];
	const previous = Number(/data-duration="([^"]+)"/.exec(tag)?.[1] ?? 0);
	const next = roundTime(Math.max(previous, duration));
	const nextTag = /data-duration="/.test(tag)
		? tag.replace(/data-duration="[^"]*"/, `data-duration="${next}"`)
		: tag.replace(/>$/, ` data-duration="${next}">`);
	return {
		html: html.slice(0, match.index) + nextTag + html.slice(match.index + tag.length),
		previous,
	};
}

function extendTerminalClips(html: string, previousRoot: number, nextRoot: number): string {
	if (nextRoot <= previousRoot + 0.05) return html;
	return html.replace(
		/<(section|div|article|h1|h2|p|figure)\b([^>]*\bclass="[^"]*\bclip\b[^"]*"[^>]*)>/gi,
		(full) => {
			if (/\bid="caption-/.test(full)) return full;
			const start = Number(/data-start="([^"]+)"/.exec(full)?.[1] ?? Number.NaN);
			const duration = Number(/data-duration="([^"]+)"/.exec(full)?.[1] ?? Number.NaN);
			if (!Number.isFinite(start) || !Number.isFinite(duration)) return full;
			if (Math.abs(start + duration - previousRoot) > 0.15) return full;
			return full.replace(
				/data-duration="[^"]*"/,
				`data-duration="${roundTime(nextRoot - start)}"`,
			);
		},
	);
}

function insertIntoRoot(html: string, snippet: string): string {
	const open = html.match(/<div\b[^>]*\bid="root"[^>]*>/i);
	if (!open || open.index === undefined) throw new Error('index.html is missing #root.');
	const tagRe = /<\/?div\b[^>]*>/gi;
	tagRe.lastIndex = open.index;
	let depth = 0;
	let match = tagRe.exec(html);
	while (match) {
		depth += match[0].startsWith('</') ? -1 : 1;
		if (match[0].startsWith('</') && depth === 0) {
			return `${html.slice(0, match.index)}\n${snippet}    ${html.slice(match.index)}`;
		}
		match = tagRe.exec(html);
	}
	throw new Error('Could not find the #root closing tag.');
}

export function renderVoiceMarkup(input: {
	audioSrc: string;
	audioDuration: number;
	audioStart?: number;
	cues: CaptionCue[];
}): string {
	const start = roundTime(input.audioStart ?? 0);
	const audio = `      <audio
        id="voiceover"
        src="${escapeHtml(input.audioSrc)}"
        data-start="${start}"
        data-duration="${roundTime(input.audioDuration)}"
        data-track-index="20"
        data-volume="1"
      ></audio>
`;
	const captions = input.cues
		.map(
			(cue) => `      <section
        id="${cue.id}"
        class="clip"
        data-start="${cue.start}"
        data-duration="${cue.duration}"
        data-track-index="8"
      >
        <div class="caption-rail">
          <p class="caption">${escapeHtml(cue.text)}</p>
        </div>
      </section>
`,
		)
		.join('');
	return `${audio}${captions}`;
}

export function applyVoiceAndCaptions(
	html: string,
	markup: string,
	compositionDuration: number,
): { html: string; duration: number } {
	let next = html
		.replace(/<audio\b[^>]*\bid="voiceover"[\s\S]*?<\/audio>\s*/gi, '')
		.replace(/<section\b[^>]*\bid="caption-\d+"[\s\S]*?<\/section>\s*/gi, '');
	next = wrapHtmlCopy(next);
	if (!next.includes('line-break: strict')) {
		next = next.includes('</style>')
			? next.replace('</style>', `${CAPTION_CSS}    </style>`)
			: next;
	} else if (!next.includes('.caption-rail')) {
		next = next.includes('</style>')
			? next.replace('</style>', `${CAPTION_CSS}    </style>`)
			: next;
	}
	const updated = updateRootDuration(next, compositionDuration);
	next = extendTerminalClips(
		updated.html,
		updated.previous,
		Math.max(updated.previous, compositionDuration),
	);
	return { html: insertIntoRoot(next, markup), duration: Math.max(updated.previous, compositionDuration) };
}
