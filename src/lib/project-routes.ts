import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Context, Hono } from 'hono';
import { assertProjectId, projectDir, REPO_ROOT } from './paths.ts';
import {
	initHyperframesProject,
	previewPayload,
	renderComposition,
	snapshotComposition,
	summarizeCommand,
} from './hyperframes.ts';
import {
	createProject,
	deleteProject,
	listProjects,
	readProject,
	type ProjectResolution,
	updateProject,
} from './projects.ts';
import { contentDisposition, downloadFileName } from './filename.ts';
import { applyProjectVoice, previewVoice } from './voiceover.ts';
import { DEFAULT_SPEAKER, resolveSpeaker, VOICES, VOICES_ROOT } from './voices.ts';

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.mp3': 'audio/mpeg',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
};

const HF_PLAYER = path.join(REPO_ROOT, 'node_modules/hyperframes/dist/hyperframes-player.global.js');
const HF_RUNTIME = path.join(REPO_ROOT, 'node_modules/hyperframes/dist/hyperframe.runtime.iife.js');
const RUNTIME_TAG = '<script src="/hf-runtime.js"></script>';

function newProjectId(): string {
	return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function injectRuntime(html: string): string {
	if (html.includes('/hf-runtime.js') || html.includes('hyperframe.runtime')) return html;
	const head = html.match(/<head[^>]*>/i);
	if (head && head.index !== undefined) {
		const at = head.index + head[0].length;
		return `${html.slice(0, at)}\n    ${RUNTIME_TAG}${html.slice(at)}`;
	}
	return `${RUNTIME_TAG}\n${html}`;
}

function asBody(bytes: Buffer): Uint8Array<ArrayBuffer> {
	return new Uint8Array(bytes);
}

function sendBytes(c: Context, bytes: Buffer, type: string, extra: Record<string, string> = {}): Response {
	const size = bytes.byteLength;
	const range = c.req.header('range');
	const headers = new Headers({
		'content-type': type,
		'accept-ranges': 'bytes',
		...extra,
	});
	if (!range) {
		headers.set('content-length', String(size));
		return new Response(asBody(bytes), { status: 200, headers });
	}
	const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
	if (!match) return new Response(asBody(bytes), { status: 200, headers });
	const last = Math.max(size - 1, 0);
	const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || size));
	const end = match[2] ? Math.min(Number(match[2]), last) : last;
	if (start > end || start > last) {
		headers.set('content-range', `bytes */${size}`);
		return new Response(null, { status: 416, headers });
	}
	headers.set('content-range', `bytes ${start}-${end}/${size}`);
	headers.set('content-length', String(end - start + 1));
	return new Response(asBody(bytes.subarray(start, end + 1)), { status: 206, headers });
}

export function registerProjectRoutes(app: Hono): void {
	app.get('/hf-player.js', async (c) => {
		return sendBytes(c, await readFile(HF_PLAYER), 'text/javascript; charset=utf-8', {
			'cache-control': 'public, max-age=3600',
		});
	});
	app.get('/hf-runtime.js', async (c) => {
		return sendBytes(c, await readFile(HF_RUNTIME), 'text/javascript; charset=utf-8', {
			'cache-control': 'public, max-age=3600',
		});
	});

	app.get('/api/projects', async (c) => {
		return c.json({ projects: await listProjects() });
	});

	app.post('/api/projects', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as {
			title?: string;
			resolution?: ProjectResolution;
		};
		const id = newProjectId();
		const project = await createProject({
			id,
			title: body.title,
			resolution: body.resolution,
		});
		return c.json({ project }, 201);
	});

	app.delete('/api/projects/:id', async (c) => {
		const id = assertProjectId(c.req.param('id'));
		const deleted = await deleteProject(id);
		if (!deleted) return c.json({ error: 'Project not found' }, 404);
		return c.json({ ok: true });
	});

	app.get('/api/projects/:id', async (c) => {
		const id = assertProjectId(c.req.param('id'));
		const existing = await readProject(id);
		if (!existing) return c.json({ error: 'Project not found' }, 404);
		if (existing.status === 'rendering') return c.json({ project: existing });
		const assets = await previewPayload(id);
		const project = await readProject(id);
		return c.json({ project: project ?? { ...existing, ...assets } });
	});

	app.post('/api/projects/:id/preview', async (c) => {
		const id = assertProjectId(c.req.param('id'));
		const project = (await readProject(id)) ?? (await createProject({ id }));
		await initHyperframesProject(id, project.resolution);
		const result = await summarizeCommand(await snapshotComposition(id));
		const assets = await previewPayload(id);
		const next = await updateProject(id, {
			...assets,
			status: assets.videoUrl ? 'exported' : result.ok ? 'preview-ready' : 'error',
			error: result.ok ? undefined : result.stderr || result.summary,
		});
		return c.json({ ok: result.ok, project: next, command: result });
	});

	app.get('/api/voices', (c) => {
		return c.json({ voices: VOICES, defaultSpeaker: DEFAULT_SPEAKER });
	});

	app.post('/api/voices/preview', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { speaker?: string; force?: boolean };
		try {
			const preview = await previewVoice(body.speaker || DEFAULT_SPEAKER, Boolean(body.force));
			return c.json({ ok: true, ...preview });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ ok: false, error: message }, 502);
		}
	});

	app.post('/api/projects/:id/voice', async (c) => {
		const id = assertProjectId(c.req.param('id'));
		const body = (await c.req.json().catch(() => ({}))) as { speaker?: string; apply?: boolean };
		const voice = resolveSpeaker(body.speaker);
		if (!body.apply) {
			const project = await updateProject(id, { speaker: voice.id });
			return c.json({ ok: true, project });
		}
		try {
			const result = await applyProjectVoice(id, voice.id);
			return c.json({ ok: true, project: result.project, applied: result.applied });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ ok: false, error: message }, 502);
		}
	});

	app.get('/media/voices/:file', async (c) => {
		const file = c.req.param('file');
		if (!/^[A-Za-z0-9_-]+\.mp3$/.test(file)) return c.json({ error: 'Not found' }, 404);
		const filePath = path.resolve(VOICES_ROOT, file);
		if (!filePath.startsWith(VOICES_ROOT + path.sep)) return c.json({ error: 'Not found' }, 404);
		try {
			return sendBytes(c, await readFile(filePath), 'audio/mpeg', { 'cache-control': 'public, max-age=86400' });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return c.json({ error: 'Not found' }, 404);
			throw error;
		}
	});

	app.post('/api/projects/:id/export', async (c) => {
		const id = assertProjectId(c.req.param('id'));
		const body = (await c.req.json().catch(() => ({}))) as { quality?: 'draft' | 'high' };
		const quality = body.quality ?? 'draft';
		const current = await readProject(id);
		if (current?.status === 'rendering') {
			return c.json({ ok: true, project: current, command: { summary: 'Export already running.' } });
		}
		await updateProject(id, {
			status: 'rendering',
			error: undefined,
			renderQuality: quality,
			renderProgress: 0,
			renderStage: '准备中',
		});
		try {
			const result = await summarizeCommand(await renderComposition(id, quality));
			const assets = await previewPayload(id);
			const next = await updateProject(id, {
				...assets,
				status: result.ok || assets.videoUrl ? 'exported' : 'error',
				error: result.ok ? undefined : result.stderr || result.summary,
				renderProgress: undefined,
				renderStage: undefined,
				renderQuality: undefined,
			});
			return c.json({ ok: result.ok, project: next, command: result });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const next = await updateProject(id, {
				status: 'error',
				error: message,
				renderProgress: undefined,
				renderStage: undefined,
				renderQuality: undefined,
			});
			return c.json({ ok: false, project: next, command: { summary: message } }, 500);
		}
	});

	app.get('/media/projects/:id/*', async (c) => {
		const id = assertProjectId(c.req.param('id'));
		const rest = c.req.path.slice(`/media/projects/${id}/`.length);
		if (!rest || rest.includes('..')) return c.json({ error: 'Not found' }, 404);
		const filePath = path.resolve(projectDir(id), rest);
		const root = projectDir(id);
		if (!filePath.startsWith(root + path.sep) && filePath !== root) {
			return c.json({ error: 'Not found' }, 404);
		}
		try {
			const info = await stat(filePath);
			if (!info.isFile()) return c.json({ error: 'Not found' }, 404);
			const ext = path.extname(filePath).toLowerCase();
			const type = MIME[ext];
			if (!type) return c.json({ error: 'Unsupported file type' }, 415);
			if (ext === '.html') {
				const html = injectRuntime(await readFile(filePath, 'utf8'));
				return c.body(html, 200, {
					'content-type': type,
					'cache-control': 'no-store',
				});
			}
			const extra: Record<string, string> = {};
			if ((ext === '.mp4' || ext === '.webm') && c.req.query('download') !== undefined) {
				const project = await readProject(id);
				extra['content-disposition'] = contentDisposition(downloadFileName(project?.title, ext.slice(1)));
			}
			return sendBytes(c, await readFile(filePath), type, extra);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return c.json({ error: 'Not found' }, 404);
			}
			throw error;
		}
	});
}
