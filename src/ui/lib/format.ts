import { type FlueConversationMessage, type FlueConversationPart } from '@flue/react';
import type { StudioState } from './api.ts';

export function conversationUrl(projectId: string): string {
	return `/api/agents/video-director/${projectId}`;
}

export function statusLabel(status: string): string {
	switch (status) {
		case 'draft':
			return '草稿';
		case 'preview-ready':
			return '可预览';
		case 'rendering':
			return '导出中';
		case 'exported':
			return '已导出';
		case 'error':
			return '出错';
		case 'streaming':
			return '生成中';
		case 'submitted':
			return '提交中';
		case 'connecting':
			return '连接中';
		case 'idle':
			return '就绪';
		default:
			return status;
	}
}

export function qualityLabel(quality?: string): string {
	return quality === 'high' ? '高清' : '标清';
}

export function stageLabel(stage?: string): string {
	if (!stage) return '准备中';
	const value = stage.toLowerCase();
	if (stage.includes('准备')) return '准备中';
	if (/compil/.test(value)) return '编译画面';
	if (/captur/.test(value)) return '逐帧抓取';
	if (/encod/.test(value)) return '编码视频';
	if (/mux|audio|ffmpeg/.test(value)) return '合成音画';
	return stage;
}

export function formatTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat('zh-CN', {
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date);
}

export function latestStudio(messages: FlueConversationMessage[]): StudioState | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message) continue;
		for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
			const part = message.parts[partIndex];
			if (!part || !isDataPart(part) || part.type !== 'data-studio') continue;
			return part.data as StudioState;
		}
	}
	return undefined;
}

export function isDataPart(
	part: FlueConversationPart,
): part is FlueConversationPart & { type: string; data: unknown } {
	return typeof part.type === 'string' && part.type.startsWith('data-') && 'data' in part;
}

export const STARTER_PROMPTS = [
	'做一个 30 秒抖音：为什么睡觉前刷手机更睡不着，要有口播、大字画面和字幕。',
	'视频号知识口播：普通人第一次买指数基金，30 秒讲清最容易踩的 3 个坑。',
	'小红书竖屏：咖啡因到底会不会脱水？用 25 秒把结论和理由讲清楚。',
];
