import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectDir } from './paths.ts';
import { sanitizeNarration } from './captions.ts';

const MAX_CHARS = 12_000;

export interface ShotBeat {
	time: string;
	visual: string;
	line: string;
}

export interface VideoPlan {
	topic: string;
	angle?: string;
	duration?: number;
	research: string;
	narration: string;
	shots: ShotBeat[];
	sources?: string[];
}

function stripHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, ' ')
		.trim();
}

export async function fetchSource(url: string): Promise<{ url: string; title?: string; text: string }> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`不是有效链接：${url}`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('只支持 http(s) 链接。');
	}

	const response = await fetch(parsed, {
		headers: { 'user-agent': 'HyperVideo/1.0 (short-video research)' },
		redirect: 'follow',
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error(`抓取失败 ${response.status}：${parsed.href}`);
	const raw = await response.text();
	const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
	let text = stripHtml(raw);
	if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}\n…(truncated)`;
	return { url: parsed.href, title, text };
}

export async function writePlan(id: string, plan: VideoPlan): Promise<{ researchPath: string; scriptPath: string }> {
	const dir = projectDir(id);
	await mkdir(dir, { recursive: true });
	const shots = plan.shots
		.map((shot, index) => `${index + 1}. **${shot.time}** ${shot.visual}\n   口播：${sanitizeNarration(shot.line)}`)
		.join('\n');
	const sources = plan.sources?.length ? plan.sources.map((item) => `- ${item}`).join('\n') : '- （模型整理 / 用户口述）';

	const research = `# ${plan.topic}\n\n${plan.angle ? `角度：${plan.angle}\n\n` : ''}## 要点\n\n${plan.research.trim()}\n\n## 来源\n\n${sources}\n`;
	const script = `# 短视频脚本\n\n- 话题：${plan.topic}\n- 时长：约 ${plan.duration ?? 30}s\n- 画幅：竖屏 1080×1920（除非用户另指定）\n${plan.angle ? `- 角度：${plan.angle}\n` : ''}\n## 口播注意\n\n- 口播、字幕、画面大字都不要用破折号「——」。改写成逗号或拆成两句。\n- 一句说完再断，别把词切断，也别让逗号、句号单独占一行。\n\n## 口播\n\n${sanitizeNarration(plan.narration)}\n\n## 分镜\n\n${shots || '（待补）'}\n`;

	const researchPath = path.join(dir, 'RESEARCH.md');
	const scriptPath = path.join(dir, 'SCRIPT.md');
	await writeFile(researchPath, research);
	await writeFile(scriptPath, script);
	return { researchPath: `projects/${id}/RESEARCH.md`, scriptPath: `projects/${id}/SCRIPT.md` };
}
