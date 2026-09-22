'use agent';
import { useDataWriter, useModel, useSandbox, useSkill, useTool } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as v from 'valibot';
import compositionSkill from '../skills/hyperframes-composition/SKILL.md';
import {
	initHyperframesProject,
	lintComposition,
	previewPayload,
	renderComposition,
	snapshotComposition,
	summarizeCommand,
} from '../lib/hyperframes.ts';
import { arkSpecifier } from '../lib/ark-provider.ts';
import { WORKSPACE_ROOT } from '../lib/paths.ts';
import {
	createProject,
	readProject,
	resolutionSize,
	type ProjectResolution,
	updateProject,
} from '../lib/projects.ts';
import { fetchSource, writePlan } from '../lib/research.ts';
import { generateVoiceover } from '../lib/voiceover.ts';

function schema<T extends v.GenericSchema>(value: T) {
	return value as T & v.GenericSchema<Record<string, unknown>, unknown>;
}

const MODEL = arkSpecifier();
const StudioState = v.object({
	projectId: v.string(),
	title: v.string(),
	status: v.picklist(['draft', 'preview-ready', 'rendering', 'exported', 'error']),
	width: v.number(),
	height: v.number(),
	duration: v.number(),
	snapshots: v.array(v.string()),
	speaker: v.optional(v.string()),
	videoUrl: v.optional(v.string()),
	voiceUrl: v.optional(v.string()),
	captionCount: v.optional(v.number()),
	hasComposition: v.optional(v.boolean()),
	compositionUrl: v.optional(v.string()),
	lintSummary: v.optional(v.string()),
	error: v.optional(v.string()),
});

type StudioState = v.InferOutput<typeof StudioState>;

async function loadStudio(id: string, patch: Partial<StudioState> = {}): Promise<StudioState> {
	const project = (await readProject(id)) ?? (await createProject({ id }));
	return {
		projectId: project.id,
		title: project.title,
		status: project.status,
		width: project.width,
		height: project.height,
		duration: project.duration,
		snapshots: project.snapshots,
		speaker: project.speaker,
		videoUrl: project.videoUrl,
		voiceUrl: project.voiceUrl,
		captionCount: project.captionCount,
		hasComposition: project.hasComposition,
		compositionUrl: project.compositionUrl,
		lintSummary: project.lintSummary,
		error: project.error,
		...patch,
	};
}

export function VideoDirector({ id }: { id: string }) {
	useModel(MODEL, { thinkingLevel: 'off' });
	useSandbox(local({ cwd: WORKSPACE_ROOT }));
	useSkill(compositionSkill);

	const writeStudio = useDataWriter('studio', { schema: StudioState });

	useTool({
		name: 'init_project',
		description:
			'Create or reuse the HyperFrames project for this conversation. Call before writing index.html if the folder is empty. Default is portrait 1080x1920 for short video.',
		input: schema(
			v.object({
				title: v.optional(v.string()),
				resolution: v.optional(v.picklist(['landscape', 'portrait', 'square'])),
				duration: v.optional(v.number()),
				brief: v.optional(v.string()),
			}),
		),
		async run({ data }) {
			const resolution = (data.resolution ?? 'portrait') as ProjectResolution;
			const size = resolutionSize(resolution);
			await createProject({ id, title: data.title, resolution });
			const init = await summarizeCommand(await initHyperframesProject(id, resolution));
			const project = await updateProject(id, {
				title: data.title?.trim() || undefined,
				resolution,
				width: size.width,
				height: size.height,
				duration: data.duration ?? 0,
				brief: data.brief,
				status: 'draft',
			});
			writeStudio(
				await loadStudio(id, {
					title: project.title,
					width: project.width,
					height: project.height,
					duration: project.duration,
					status: 'draft',
				}),
			);
			return [
				init.ok ? 'Project initialized.' : `Init warning: ${init.summary}`,
				`Title: ${project.title}`,
				`Size: ${project.width}x${project.height}`,
				`Write the composition at projects/${id}/index.html`,
				init.stderr ? `stderr:\n${init.stderr}` : '',
			]
				.filter(Boolean)
				.join('\n');
		},
	});

	useTool({
		name: 'fetch_source',
		description:
			'Fetch a public http(s) URL and return readable text for short-video research. Use when the user pasted a link, or when you need a specific article/page. Do not invent URLs.',
		input: schema(v.object({ url: v.string() })),
		async run({ data }) {
			const page = await fetchSource(data.url);
			return [`URL: ${page.url}`, page.title ? `Title: ${page.title}` : '', page.text].filter(Boolean).join('\n');
		},
	});

	useTool({
		name: 'save_plan',
		description:
			'Persist the topic research, spoken script, and shot list to RESEARCH.md and SCRIPT.md. Call after gathering facts and before writing index.html.',
		input: schema(
			v.object({
				topic: v.string(),
				angle: v.optional(v.string()),
				duration: v.optional(v.number()),
				research: v.string(),
				narration: v.string(),
				sources: v.optional(v.array(v.string())),
				shots: v.array(
					v.object({
						time: v.string(),
						visual: v.string(),
						line: v.string(),
					}),
				),
			}),
		),
		async run({ data }) {
			const files = await writePlan(id, data);
			await updateProject(id, {
				title: data.topic.trim() || undefined,
				duration: data.duration,
				brief: data.angle ? `${data.topic} — ${data.angle}` : data.topic,
			});
			writeStudio(
				await loadStudio(id, {
					title: data.topic.trim(),
					...(data.duration ? { duration: data.duration } : {}),
				}),
			);
			return [
				`Saved ${files.researchPath} and ${files.scriptPath}.`,
				`Topic: ${data.topic}`,
				data.duration ? `Target duration: ${data.duration}s` : '',
				`Shots: ${data.shots.length}`,
				'Next: init_project (portrait unless asked otherwise), write index.html from the shot list, then generate_voiceover with the narration.',
			]
				.filter(Boolean)
				.join('\n');
		},
	});

	useTool({
		name: 'rename_project',
		description: 'Update the studio project title shown in the left sidebar.',
		input: schema(v.object({ title: v.string() })),
		async run({ data }) {
			const project = await updateProject(id, { title: data.title.trim() || '未命名项目' });
			writeStudio(await loadStudio(id, { title: project.title }));
			return `Project title is now ${project.title}.`;
		},
	});

	useTool({
		name: 'lint_composition',
		description:
			'Run hyperframes lint on this project and return findings. Call after every HTML write or edit. Fix errors before capturing preview.',
		async run() {
			const result = await summarizeCommand(await lintComposition(id));
			writeStudio(
				await loadStudio(id, {
					lintSummary: result.ok ? 'Lint passed.' : result.stderr || result.stdout || result.summary,
					status: result.ok ? 'draft' : 'error',
					error: result.ok ? undefined : result.stderr || result.summary,
				}),
			);
			return result.ok
				? `Lint passed.\n${result.stdout}`
				: `Lint failed.\n${result.stderr || result.stdout || result.summary}`;
		},
	});

	useTool({
		name: 'capture_preview',
		description:
			'Capture still frames of the current composition and publish them to the right-hand preview panel. Call after lint is clean, or whenever the user should see an updated preview.',
		input: schema(
			v.object({
				frames: v.optional(v.number()),
				duration: v.optional(v.number()),
				title: v.optional(v.string()),
			}),
		),
		async run({ data }) {
			if (data.title) await updateProject(id, { title: data.title });
			if (data.duration) await updateProject(id, { duration: data.duration });
			writeStudio(await loadStudio(id, { status: 'draft', lintSummary: 'Capturing preview frames…' }));
			const lint = await summarizeCommand(await lintComposition(id));
			if (!lint.ok) {
				const studio = await loadStudio(id, {
					status: 'error',
					lintSummary: lint.stderr || lint.stdout || lint.summary,
					error: 'Lint failed; preview was not captured.',
				});
				writeStudio(studio);
				return `Lint failed; preview was not captured.\n${lint.stderr || lint.stdout || lint.summary}`;
			}
			const snap = await summarizeCommand(await snapshotComposition(id, data.frames ?? 6));
			const assets = await previewPayload(id);
			const studio = await loadStudio(id, {
				...assets,
				status: snap.ok ? 'preview-ready' : 'error',
				lintSummary: 'Lint passed.',
				error: snap.ok ? undefined : snap.stderr || snap.summary,
			});
			writeStudio(studio);
			return snap.ok
				? `Preview captured (${studio.snapshots.length} frames). The right-hand panel should update.`
				: `Snapshot failed.\n${snap.stderr || snap.summary}`;
		},
	});

	useTool({
		name: 'generate_voiceover',
		description:
			'Generate Doubao TTS narration and burn timed captions into index.html. Use the speaker already saved on the project unless the user named a different voice. The studio 使用 button also regenerates voice and realigns captions — do not duplicate that unless they asked in chat.',
		input: schema(
			v.object({
				text: v.string(),
				speaker: v.optional(v.string()),
				speechRate: v.optional(v.number()),
				emotion: v.optional(v.string()),
				captions: v.optional(v.boolean()),
				force: v.optional(v.boolean()),
			}),
		),
		async run({ data }) {
			try {
				const result = await generateVoiceover(id, data);
				const project = await updateProject(id, {
					duration: result.compositionDuration,
					voiceUrl: result.voiceUrl,
					captionCount: result.captionCount,
					speaker: result.speaker,
					status: 'draft',
				});
				writeStudio(
					await loadStudio(id, {
						duration: project.duration,
						voiceUrl: result.voiceUrl,
						captionCount: result.captionCount,
						speaker: result.speaker,
						status: 'draft',
						lintSummary: result.patchedHtml
							? `Voiceover ready (${result.duration}s, ${result.captionCount} captions).`
							: 'Voiceover audio written; index.html was missing so captions were not patched.',
					}),
				);
				return [
					result.reused ? 'Reused existing Doubao audio (same script).' : 'Generated Doubao voiceover.',
					`Audio: ${result.audioPath} (${result.duration}s)`,
					`Speaker: ${result.speaker}`,
					result.captionCount
						? `Captions: ${result.captionCount} cues in ${result.captionsPath}`
						: 'Captions skipped.',
					result.patchedHtml
						? 'Patched index.html with <audio id="voiceover"> and #caption-* clips. Do not delete those nodes.'
						: 'Wrote audio/captions.json only. Create index.html, then call this tool again.',
				].join('\n');
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				writeStudio(await loadStudio(id, { status: 'error', error: message }));
				return `Voiceover failed: ${message}`;
			}
		},
	});

	useTool({
		name: 'export_video',
		description:
			'Render the composition to MP4 and publish a downloadable file in the studio panel. Only call when the user asks to export, download, or render the video.',
		input: schema(
			v.object({
				quality: v.optional(v.picklist(['draft', 'high'])),
			}),
		),
		async run({ data }) {
			writeStudio(await loadStudio(id, { status: 'rendering' }));
			await updateProject(id, {
				status: 'rendering',
				renderQuality: data.quality ?? 'draft',
				renderProgress: 0,
				renderStage: '准备中',
			});
			try {
				const result = await summarizeCommand(await renderComposition(id, data.quality ?? 'draft'));
				const assets = await previewPayload(id);
				const next = await updateProject(id, {
					...assets,
					status: result.ok || assets.videoUrl ? 'exported' : 'error',
					error: result.ok ? undefined : result.stderr || result.summary,
					renderProgress: undefined,
					renderStage: undefined,
					renderQuality: undefined,
				});
				const studio = await loadStudio(id, {
					...assets,
					status: next.status,
					error: next.error,
				});
				writeStudio(studio);
				return result.ok
					? `Exported MP4: ${studio.videoUrl ?? 'exports/video.mp4'}`
					: `Export failed.\n${result.stderr || result.summary}`;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await updateProject(id, {
					status: 'error',
					error: message,
					renderProgress: undefined,
					renderStage: undefined,
					renderQuality: undefined,
				});
				writeStudio(await loadStudio(id, { status: 'error', error: message }));
				return `Export failed.\n${message}`;
			}
		},
	});

	return `You are Hyper Video's short-video director. The user is a 短视频博主. The product is NOT a generic motion-graphics or title-card tool.

This conversation is project \`${id}\`. Files live at \`projects/${id}/\`.

Pipeline — do not skip or reorder:
1. **Topic.** If they only said “做个视频” and gave no topic, ask for the topic (and optional platform: 抖音 / 视频号 / 小红书). Do not ask a long intake. Defaults: 竖屏 1080×1920, 20–45 秒, 口播+字幕+大字画面.
2. **Research.** Gather facts before scripting. If they pasted a URL, call \`fetch_source\`. If they pasted notes, use those. Otherwise compile a tight fact sheet from knowledge and label uncertainties; do not invent statistics, quotes, or news. Then call \`save_plan\` with research + spoken narration + shot list (time / on-screen visual / line).
3. **Script + picture.** \`save_plan\` writes RESEARCH.md and SCRIPT.md. In chat, show a short 口播稿 and 分镜 (one beat per scene). **口播、字幕、画面大字都不要用破折号「——」**，改写成逗号或两句。Then \`init_project\` (portrait unless they asked landscape/square) and write \`index.html\` that follows the shot list — big type, one idea per scene, vertical composition. This is a faceless explainer/listicle look, not a logo sting or film-title card unless they explicitly asked for that.
4. **Picture + audio + captions.** After HTML exists, call \`generate_voiceover\` with the spoken narration (plain sentences, no em dashes). Use the project's selected speaker. The user can preview voices and click 使用 in the right panel to replace the voice and realign captions; only pass \`speaker\` if they named a different voice in chat. Skip only for a silent piece; pass captions=false for voice without subtitles.
5. **Preview.** \`lint_composition\`, fix errors, \`capture_preview\`. If you rewrite index.html, call \`generate_voiceover\` again.
6. **Ship.** Iterate from notes. Call \`export_video\` only when they ask to export / download / 出片. Use draft (标清) unless they ask for 高清.

Voice rules:
- Never call audio.play() / pause / seek. HyperFrames owns <audio> playback.
- Keep \`#voiceover\` and \`#caption-*\` as direct children of #root. Captions use class="clip"; the audio tag does not.
- Spoken copy: no 「——」. Prefer short clauses that end on ，。！？ so captions never hang a comma/period alone or split a word.
- On-screen captions omit trailing ，。、； and keep ？！.
- On-screen titles: break lines at ，。！？ using a newline and white-space pre-line. Do not let the browser wrap in the middle of a word.
- Do not invent API keys or hit the Doubao HTTP API yourself; \`generate_voiceover\` already has the key.

Activate the \`hyperframes-composition\` skill before writing HTML. Call \`rename_project\` when the topic is clear.

If Chrome, FFmpeg, or HyperFrames is missing, say so plainly and still leave a valid \`index.html\`. Never render on first draft unless they explicitly want a file immediately.`;
}
