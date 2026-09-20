import path from 'node:path';

export const REPO_ROOT = process.cwd();
export const WORKSPACE_ROOT = path.resolve(REPO_ROOT, 'workspace');
export const PROJECTS_ROOT = path.join(WORKSPACE_ROOT, 'projects');

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

export function assertProjectId(id: string): string {
	if (!PROJECT_ID.test(id)) {
		throw new Error(`Invalid project id: ${id}`);
	}
	return id;
}

export function projectDir(id: string): string {
	return path.join(PROJECTS_ROOT, assertProjectId(id));
}

export function mediaUrl(id: string, relativePath: string): string {
	const clean = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
	return `/media/projects/${assertProjectId(id)}/${clean}`;
}
