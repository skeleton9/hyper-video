import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mediaUrl, PROJECTS_ROOT, projectDir, REPO_ROOT } from './paths.ts';
import { DEFAULT_SPEAKER } from './voices.ts';

export type ProjectStatus = 'draft' | 'preview-ready' | 'rendering' | 'exported' | 'error';
export type ProjectResolution = 'landscape' | 'portrait' | 'square';

export interface ProjectRecord {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	status: ProjectStatus;
	resolution: ProjectResolution;
	width: number;
	height: number;
	duration: number;
	brief?: string;
	error?: string;
	lintSummary?: string;
	snapshots: string[];
	speaker?: string;
	renderQuality?: 'draft' | 'high';
	renderProgress?: number;
	renderStage?: string;
	videoUrl?: string;
	voiceUrl?: string;
	captionCount?: number;
	hasComposition?: boolean;
	compositionUrl?: string;
}

const RESOLUTION_SIZE: Record<ProjectResolution, { width: number; height: number }> = {
	landscape: { width: 1920, height: 1080 },
	portrait: { width: 1080, height: 1920 },
	square: { width: 1080, height: 1080 },
};

function recordPath(id: string): string {
	return path.join(projectDir(id), 'project.json');
}

export function resolutionSize(resolution: ProjectResolution) {
	return RESOLUTION_SIZE[resolution];
}

export async function ensureProjectsRoot(): Promise<void> {
	await mkdir(PROJECTS_ROOT, { recursive: true });
}

async function attachCompositionMeta(record: ProjectRecord): Promise<ProjectRecord> {
	try {
		const info = await stat(path.join(projectDir(record.id), 'index.html'));
		return {
			...record,
			hasComposition: true,
			compositionUrl: `${mediaUrl(record.id, 'index.html')}?t=${Math.round(info.mtimeMs)}`,
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		return { ...record, hasComposition: false, compositionUrl: undefined };
	}
}

export async function readProject(id: string): Promise<ProjectRecord | undefined> {
	try {
		const raw = await readFile(recordPath(id), 'utf8');
		return attachCompositionMeta(JSON.parse(raw) as ProjectRecord);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw error;
	}
}

export async function writeProject(record: ProjectRecord): Promise<ProjectRecord> {
	const next = { ...record, updatedAt: new Date().toISOString() };
	await mkdir(projectDir(record.id), { recursive: true });
	await writeFile(recordPath(record.id), `${JSON.stringify(next, null, 2)}\n`);
	return attachCompositionMeta(next);
}

export async function createProject(input: {
	id: string;
	title?: string;
	resolution?: ProjectResolution;
}): Promise<ProjectRecord> {
	await ensureProjectsRoot();
	const existing = await readProject(input.id);
	if (existing) return existing;

	const resolution = input.resolution ?? 'portrait';
	const size = resolutionSize(resolution);
	const now = new Date().toISOString();
	return writeProject({
		id: input.id,
		title: input.title?.trim() || '未命名项目',
		createdAt: now,
		updatedAt: now,
		status: 'draft',
		resolution,
		width: size.width,
		height: size.height,
		duration: 0,
		snapshots: [],
		speaker: DEFAULT_SPEAKER,
	});
}

export async function listProjects(): Promise<ProjectRecord[]> {
	await ensureProjectsRoot();
	const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true });
	const projects: ProjectRecord[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const project = await readProject(entry.name);
		if (project) projects.push(project);
	}
	return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function updateProject(
	id: string,
	patch: Partial<Omit<ProjectRecord, 'id' | 'createdAt'>>,
): Promise<ProjectRecord> {
	const current = (await readProject(id)) ?? (await createProject({ id }));
	const cleaned = Object.fromEntries(
		Object.entries(patch).filter(
			([key, value]) =>
				value !== undefined ||
				key === 'error' ||
				key === 'renderProgress' ||
				key === 'renderStage' ||
				key === 'renderQuality',
		),
	) as Partial<ProjectRecord>;
	const next = { ...current, ...cleaned, id: current.id, createdAt: current.createdAt };
	if ('error' in cleaned && cleaned.error === undefined) delete next.error;
	if ('renderProgress' in cleaned && cleaned.renderProgress === undefined) delete next.renderProgress;
	if ('renderStage' in cleaned && cleaned.renderStage === undefined) delete next.renderStage;
	if ('renderQuality' in cleaned && cleaned.renderQuality === undefined) delete next.renderQuality;
	return writeProject(next);
}

export async function collectPreviewAssets(id: string): Promise<{
	snapshots: string[];
	videoUrl?: string;
	voiceUrl?: string;
	captionCount?: number;
	hasComposition?: boolean;
	compositionUrl?: string;
}> {
	const dir = projectDir(id);
	const snapshots: string[] = [];

	for (const folder of ['snapshots', 'renders']) {
		try {
			const files = await readdir(path.join(dir, folder));
			for (const file of files.sort()) {
				if (!file.toLowerCase().endsWith('.png')) continue;
				if (file.startsWith('finding-')) continue;
				snapshots.push(mediaUrl(id, `${folder}/${file}`));
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}

	const videoCandidates = ['exports/video.mp4', 'exports/video.webm', 'out.mp4'];
	let videoUrl: string | undefined;
	for (const candidate of videoCandidates) {
		try {
			await readFile(path.join(dir, candidate));
			videoUrl = mediaUrl(id, candidate);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}

	let voiceUrl: string | undefined;
	try {
		await readFile(path.join(dir, 'audio/voiceover.mp3'));
		voiceUrl = mediaUrl(id, 'audio/voiceover.mp3');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}

	let captionCount: number | undefined;
	try {
		const ledger = JSON.parse(await readFile(path.join(dir, 'captions.json'), 'utf8')) as {
			cues?: unknown[];
		};
		if (Array.isArray(ledger.cues)) captionCount = ledger.cues.length;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}

	const composition = await attachCompositionMeta({ id } as ProjectRecord);
	return {
		snapshots,
		videoUrl,
		voiceUrl,
		captionCount,
		hasComposition: composition.hasComposition,
		compositionUrl: composition.compositionUrl,
	};
}

export async function refreshProjectAssets(id: string): Promise<ProjectRecord> {
	const assets = await collectPreviewAssets(id);
	const status: ProjectStatus = assets.videoUrl
		? 'exported'
		: assets.snapshots.length || assets.hasComposition
			? 'preview-ready'
			: 'draft';
	return updateProject(id, { ...assets, status, error: undefined });
}

function purgeFlueConversation(id: string): void {
	const dbPath = path.join(REPO_ROOT, 'data', 'flue.db');
	if (!existsSync(dbPath)) return;
	let db: DatabaseSync;
	try {
		db = new DatabaseSync(dbPath);
	} catch {
		return;
	}

	const streamPath = `agents/VideoDirector/${id}`;
	const sessionKey = `agent-session:["VideoDirector","${id}","default","default"]`;
	try {
		db.exec('BEGIN');
		db.prepare('DELETE FROM flue_conversation_stream_batch_chunks WHERE path = ?').run(streamPath);
		db.prepare('DELETE FROM flue_conversation_stream_batches WHERE path = ?').run(streamPath);
		db.prepare('DELETE FROM flue_conversation_fold_checkpoint_chunks WHERE path = ?').run(streamPath);
		db.prepare('DELETE FROM flue_conversation_fold_checkpoints WHERE path = ?').run(streamPath);
		db.prepare('DELETE FROM flue_conversation_streams WHERE path = ?').run(streamPath);
		db.prepare('DELETE FROM flue_attachment_chunks WHERE stream_path = ?').run(streamPath);
		db.prepare('DELETE FROM flue_attachments WHERE stream_path = ? OR conversation_id = ?').run(
			streamPath,
			id,
		);
		const submissions = db
			.prepare('SELECT submission_id FROM flue_agent_submissions WHERE session_key = ?')
			.all(sessionKey) as Array<{ submission_id: string }>;
		const removeChunk = db.prepare('DELETE FROM flue_submission_chunks WHERE submission_id = ?');
		for (const row of submissions) removeChunk.run(row.submission_id);
		db.prepare('DELETE FROM flue_agent_submissions WHERE session_key = ?').run(sessionKey);
		db.exec('COMMIT');
	} catch {
		try {
			db.exec('ROLLBACK');
		} catch {
			/* already closed or no transaction */
		}
	} finally {
		db.close();
	}
}

export async function deleteProject(id: string): Promise<boolean> {
	const dir = projectDir(id);
	let existed = false;
	try {
		await stat(dir);
		existed = true;
		await rm(dir, { recursive: true, force: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	purgeFlueConversation(id);
	return existed;
}
