import path from 'node:path';
import { WORKSPACE_ROOT } from './paths.ts';

export const DEFAULT_SPEAKER = 'zh_female_shuangkuaisisi_moon_bigtts';
export const PREVIEW_LINE = '你好，我是这条短视频的旁白。先听一下这个音色。';

export interface VoiceOption {
	id: string;
	label: string;
	gender: 'female' | 'male';
	resourceId: 'seed-tts-1.0' | 'seed-tts-2.0';
	hint: string;
}

export const VOICES: VoiceOption[] = [
	{ id: 'zh_female_shuangkuaisisi_moon_bigtts', label: '爽快思思', gender: 'female', resourceId: 'seed-tts-1.0', hint: '默认 · 短视频口播' },
	{ id: 'zh_female_cancan_mars_bigtts', label: '灿灿', gender: 'female', resourceId: 'seed-tts-1.0', hint: '活泼开朗' },
	{ id: 'zh_female_qingxinnvsheng_mars_bigtts', label: '清新女声', gender: 'female', resourceId: 'seed-tts-1.0', hint: '清新淡雅' },
	{ id: 'zh_female_zhixingnvsheng_mars_bigtts', label: '知性女声', gender: 'female', resourceId: 'seed-tts-1.0', hint: '成熟稳' },
	{ id: 'zh_female_tianmeixiaoyuan_moon_bigtts', label: '甜美小源', gender: 'female', resourceId: 'seed-tts-1.0', hint: '甜美' },
	{ id: 'zh_female_linjianvhai_moon_bigtts', label: '邻家女孩', gender: 'female', resourceId: 'seed-tts-1.0', hint: '亲切' },
	{ id: 'zh_female_kailangjiejie_moon_bigtts', label: '开朗姐姐', gender: 'female', resourceId: 'seed-tts-1.0', hint: '大姐姐' },
	{ id: 'zh_female_xinlingjitang_moon_bigtts', label: '心灵鸡汤', gender: 'female', resourceId: 'seed-tts-1.0', hint: '温情' },
	{ id: 'zh_male_wennuanahu_moon_bigtts', label: '温暖阿虎', gender: 'male', resourceId: 'seed-tts-1.0', hint: '温暖男声' },
	{ id: 'zh_male_shaonianzixin_moon_bigtts', label: '少年梓辛', gender: 'male', resourceId: 'seed-tts-1.0', hint: '少年' },
	{ id: 'zh_male_yuanboxiaoshu_moon_bigtts', label: '渊博小叔', gender: 'male', resourceId: 'seed-tts-1.0', hint: '知识口播' },
	{ id: 'zh_male_yangguangqingnian_moon_bigtts', label: '阳光青年', gender: 'male', resourceId: 'seed-tts-1.0', hint: '阳光' },
	{ id: 'zh_male_jieshuoxiaoming_moon_bigtts', label: '解说小明', gender: 'male', resourceId: 'seed-tts-1.0', hint: '解说' },
	{ id: 'zh_male_qingshuangnanda_mars_bigtts', label: '清爽男大', gender: 'male', resourceId: 'seed-tts-1.0', hint: '大学生' },
	{ id: 'zh_female_xiaohe_uranus_bigtts', label: '小何 2.0', gender: 'female', resourceId: 'seed-tts-2.0', hint: '自然亲切' },
	{ id: 'zh_female_vv_uranus_bigtts', label: 'Vivi 2.0', gender: 'female', resourceId: 'seed-tts-2.0', hint: '多语种' },
	{ id: 'zh_male_m191_uranus_bigtts', label: '云舟 2.0', gender: 'male', resourceId: 'seed-tts-2.0', hint: '通用男声' },
	{ id: 'zh_male_taocheng_uranus_bigtts', label: '小天 2.0', gender: 'male', resourceId: 'seed-tts-2.0', hint: '年轻男声' },
];

export const VOICES_ROOT = path.join(WORKSPACE_ROOT, 'voices');

export function findVoice(id: string | undefined): VoiceOption | undefined {
	if (!id?.trim()) return undefined;
	return VOICES.find((voice) => voice.id === id.trim());
}

export function resolveSpeaker(id?: string): VoiceOption {
	return findVoice(id) ?? findVoice(process.env.DOUBAO_SPEAKER) ?? VOICES[0]!;
}

export function voiceLabel(id: string | undefined): string {
	return findVoice(id)?.label ?? id?.trim() ?? resolveSpeaker().label;
}

export function safeVoiceFile(speaker: string): string {
	return `${speaker.replace(/[^A-Za-z0-9_-]/g, '_')}.mp3`;
}

export function previewUrl(speaker: string, stamp?: number): string {
	const file = safeVoiceFile(speaker);
	return stamp ? `/media/voices/${file}?t=${stamp}` : `/media/voices/${file}`;
}
