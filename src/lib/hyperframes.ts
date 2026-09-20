import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { PROJECTS_ROOT, REPO_ROOT, projectDir } from './paths.ts';
import { type ProjectResolution, collectPreviewAssets, readProject, updateProject } from './projects.ts';

const BIN_DIR = path.join(REPO_ROOT, 'node_modules', '.bin');
const DEFAULT_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 12 * 60_000;

export interface CommandResult {
	ok: boolean;
	code: number;
	stdout: string;
	stderr: string;
}

function systemChromePaths(): string[] {
	if (process.platform === 'darwin') {
		return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
	}
	if (process.platform === 'win32') {
		const programFiles = process.env.ProgramW6432 ?? process.env.PROGRAMFILES ?? 'C:\\Program Files';
		const x86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
		const local = process.env.LOCALAPPDATA;
		return [
			path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
			path.join(x86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
			...(local ? [path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')] : []),
		];
	}
	return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
}

function cachedHeadlessShells(): string[] {
	const root = path.join(homedir(), '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell');
	if (!existsSync(root)) return [];
	const found: string[] = [];
	for (const version of readdirSync(root)) {
		const versionDir = path.join(root, version);
		for (const name of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64', 'chrome-headless-shell-win64', 'chrome-headless-shell-win32']) {
			for (const bin of ['chrome-headless-shell', 'chrome-headless-shell.exe']) {
				const candidate = path.join(versionDir, name, bin);
				if (existsSync(candidate)) found.push(candidate);
			}
		}
	}
	return found;
}

function browserResponds(bin: string): boolean {
	if (!existsSync(bin)) return false;
	try {
		chmodSync(bin, 0o755);
	} catch {
		/* ignore missing permission to chmod */
	}
	const result = spawnSync(bin, ['--version'], {
		timeout: 8_000,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true,
	});
	return result.status === 0 && Boolean(result.stdout?.trim());
}

function resolveBrowserPath(): string | undefined {
	const fromEnv = process.env.HYPERFRAMES_BROWSER_PATH?.trim();
	if (fromEnv && existsSync(fromEnv)) return fromEnv;
	// Cached chrome-headless-shell can exist and still fail `--version` with EACCES
	// when spawned from the studio process. System Chrome is enough to write MP4.
	const system = systemChromePaths().find(existsSync);
	if (system) return system;
	return cachedHeadlessShells().find(browserResponds) ?? cachedHeadlessShells()[0];
}

function commandEnv(): NodeJS.ProcessEnv {
	const browserPath = resolveBrowserPath();
	return {
		...process.env,
		PATH: `${BIN_DIR}${path.delimiter}${process.env.PATH ?? ''}`,
		HYPERFRAMES_SKIP_SKILLS: '1',
		...(browserPath ? { HYPERFRAMES_BROWSER_PATH: browserPath } : {}),
	};
}

function parseRenderProgress(chunk: string): { percent?: number; stage?: string } {
	const clean = chunk.replace(/\u001b\[[0-9;]*m/g, '');
	let percent: number | undefined;
	let stage: string | undefined;
	const progress = /"progress"\s*:\s*(\d+(?:\.\d+)?)/.exec(clean);
	if (progress) percent = Number(progress[1]);
	const named = /"stage"\s*:\s*"([^"]+)"/.exec(clean);
	if (named) stage = named[1];
	const bar = /(\d+(?:\.\d+)?)%\s+([^\n\r]+)/.exec(clean);
	if (bar) {
		percent = Number(bar[1]);
		stage = bar[2]?.trim() || stage;
	}
	if (percent !== undefined && !Number.isFinite(percent)) percent = undefined;
	if (percent !== undefined) percent = Math.max(0, Math.min(100, Math.round(percent)));
	return { percent, stage };
}

export function runCommand(
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs?: number; onOutput?: (chunk: string) => void },
): Promise<CommandResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: commandEnv(),
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => {
			child.kill('SIGTERM');
			reject(new Error(`${command} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		const handle = (chunk: Buffer) => {
			const text = chunk.toString();
			options.onOutput?.(text);
			return text;
		};
		child.stdout.on('data', (chunk: Buffer) => {
			stdout += handle(chunk);
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += handle(chunk);
		});
		child.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ ok: code === 0, code: code ?? 1, stdout, stderr });
		});
	});
}

function clip(text: string, max = 8000): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max)}\n…(truncated)`;
}

export async function initHyperframesProject(
	id: string,
	resolution: ProjectResolution,
): Promise<CommandResult> {
	await mkdir(PROJECTS_ROOT, { recursive: true });
	const dir = projectDir(id);
	try {
		const files = await readdir(dir);
		if (files.includes('index.html') || files.includes('hyperframes.json')) {
			return { ok: true, code: 0, stdout: 'Project already initialized.', stderr: '' };
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}

	return runCommand(
		'npx',
		[
			'hyperframes',
			'init',
			dir,
			'--non-interactive',
			'--example',
			'blank',
			'--resolution',
			resolution,
			'--skill=general-video',
		],
		{ cwd: REPO_ROOT, timeoutMs: 180_000 },
	);
}

export async function lintComposition(id: string): Promise<CommandResult> {
	return runCommand('npx', ['hyperframes', 'lint', '--json'], { cwd: projectDir(id) });
}

export async function snapshotComposition(id: string, frames = 6): Promise<CommandResult> {
	return runCommand('npx', ['hyperframes', 'snapshot', '--frames', String(frames), '--json'], {
		cwd: projectDir(id),
		timeoutMs: 180_000,
	});
}

export async function renderComposition(
	id: string,
	quality: 'draft' | 'high' = 'draft',
): Promise<CommandResult> {
	await mkdir(path.join(projectDir(id), 'exports'), { recursive: true });
	let lastWrite = 0;
	return runCommand(
		'npx',
		['hyperframes', 'render', '--quality', quality, '--output', 'exports/video.mp4', '--json'],
		{
			cwd: projectDir(id),
			timeoutMs: RENDER_TIMEOUT_MS,
			onOutput: (chunk) => {
				const parsed = parseRenderProgress(chunk);
				if (parsed.percent === undefined && !parsed.stage) return;
				const now = Date.now();
				if (now - lastWrite < 400) return;
				lastWrite = now;
				void updateProject(id, {
					status: 'rendering',
					renderQuality: quality,
					...(parsed.percent !== undefined ? { renderProgress: parsed.percent } : {}),
					...(parsed.stage ? { renderStage: parsed.stage } : {}),
				}).catch(() => undefined);
			},
		},
	);
}

export async function summarizeCommand(result: CommandResult): Promise<{
	ok: boolean;
	summary: string;
	stdout: string;
	stderr: string;
}> {
	return {
		ok: result.ok,
		summary: result.ok ? 'Command succeeded.' : `Command failed (exit ${result.code}).`,
		stdout: clip(result.stdout),
		stderr: clip(result.stderr),
	};
}

export async function previewPayload(id: string) {
	const assets = await collectPreviewAssets(id);
	const current = await readProject(id);
	if (current?.status === 'rendering') {
		await updateProject(id, assets);
		return assets;
	}
	await updateProject(id, {
		...assets,
		status: assets.videoUrl ? 'exported' : assets.snapshots.length || assets.hasComposition ? 'preview-ready' : 'draft',
		...(assets.videoUrl ? { error: undefined } : {}),
	});
	return assets;
}
