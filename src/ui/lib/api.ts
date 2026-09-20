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

export interface VoiceOption {
	id: string;
	label: string;
	gender: 'female' | 'male';
	hint: string;
}

export interface StudioState {
	projectId: string;
	title: string;
	status: ProjectStatus;
	width: number;
	height: number;
	duration: number;
	snapshots: string[];
	speaker?: string;
	videoUrl?: string;
	voiceUrl?: string;
	captionCount?: number;
	hasComposition?: boolean;
	compositionUrl?: string;
	lintSummary?: string;
	error?: string;
}

export async function fetchProjects(): Promise<ProjectRecord[]> {
	const response = await fetch('/api/projects');
	if (!response.ok) throw new Error('无法加载项目列表');
	const body = (await response.json()) as { projects: ProjectRecord[] };
	return body.projects;
}

export async function createProject(input?: {
	title?: string;
	resolution?: ProjectResolution;
}): Promise<ProjectRecord> {
	const response = await fetch('/api/projects', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input ?? {}),
	});
	if (!response.ok) throw new Error('无法创建项目');
	const body = (await response.json()) as { project: ProjectRecord };
	return body.project;
}

export async function fetchProject(id: string): Promise<ProjectRecord> {
	const response = await fetch(`/api/projects/${id}`);
	if (!response.ok) throw new Error('项目不存在');
	const body = (await response.json()) as { project: ProjectRecord };
	return body.project;
}

export async function requestPreview(id: string): Promise<ProjectRecord> {
	const response = await fetch(`/api/projects/${id}/preview`, { method: 'POST' });
	const body = (await response.json()) as { project: ProjectRecord; ok: boolean; command?: { summary?: string } };
	if (!response.ok || !body.ok) {
		throw new Error(body.project?.error || body.command?.summary || '预览生成失败');
	}
	return body.project;
}

export async function requestExport(id: string, quality: 'draft' | 'high'): Promise<ProjectRecord> {
	const response = await fetch(`/api/projects/${id}/export`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ quality }),
	});
	const body = (await response.json()) as { project: ProjectRecord; ok: boolean; command?: { summary?: string } };
	if (!response.ok || !body.ok) {
		throw new Error(body.project?.error || body.command?.summary || '导出失败');
	}
	return body.project;
}

export async function abortConversation(id: string): Promise<void> {
	await fetch(`/api/agents/video-director/${id}/abort`, { method: 'POST' });
}

export async function fetchVoices(): Promise<VoiceOption[]> {
	const response = await fetch('/api/voices');
	if (!response.ok) throw new Error('无法加载音色列表');
	const body = (await response.json()) as { voices: VoiceOption[] };
	return body.voices;
}

export async function applyProjectVoice(id: string, speaker: string): Promise<ProjectRecord> {
	const response = await fetch(`/api/projects/${id}/voice`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ speaker, apply: true }),
	});
	const body = (await response.json()) as { project?: ProjectRecord; error?: string };
	if (!response.ok || !body.project) throw new Error(body.error || '无法替换音色');
	return body.project;
}

export async function previewVoice(speaker: string): Promise<string> {
	const response = await fetch('/api/voices/preview', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ speaker }),
	});
	const body = (await response.json()) as { ok?: boolean; url?: string; error?: string };
	if (!response.ok || !body.ok || !body.url) throw new Error(body.error || '试听失败');
	return body.url;
}

export async function deleteProject(id: string): Promise<void> {
	const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
	if (!response.ok && response.status !== 404) {
		throw new Error('无法删除项目');
	}
}
