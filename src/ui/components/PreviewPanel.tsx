import { useEffect, useRef, useState } from 'react';
import type { ProjectRecord } from '../lib/api.ts';
import { downloadFileName } from '../../lib/filename.ts';
import { qualityLabel, stageLabel } from '../lib/format.ts';
import { CompositionPlayer, type HyperframesPlayerElement } from './CompositionPlayer.tsx';
import { VoicePicker } from './VoicePicker.tsx';

const QUALITY_KEY = 'hyper-video:export-quality';
type ExportQuality = 'draft' | 'high';

function readSavedQuality(): ExportQuality {
	return localStorage.getItem(QUALITY_KEY) === 'draft' ? 'draft' : 'high';
}

export function PreviewPanel({
	project,
	busy,
	actionError,
	onPreview,
	onExport,
	onVoiceApply,
	onVoicePreview,
}: {
	project: ProjectRecord | undefined;
	busy: boolean;
	actionError?: string;
	onPreview: () => Promise<void>;
	onExport: (quality: 'draft' | 'high') => Promise<void>;
	onVoiceApply: (speaker: string) => Promise<void>;
	onVoicePreview: (speaker: string) => Promise<string>;
}) {
	const [frame, setFrame] = useState(0);
	const [elapsed, setElapsed] = useState(0);
	const [expanded, setExpanded] = useState(false);
	const [quality, setQuality] = useState<ExportQuality>(readSavedQuality);
	const playerRef = useRef<HyperframesPlayerElement | null>(null);
	const stageRef = useRef<HTMLDivElement | null>(null);
	const snapshots = project?.snapshots ?? [];
	const active = snapshots[Math.min(frame, Math.max(snapshots.length - 1, 0))];
	const ratio = project ? `${project.width} / ${project.height}` : '9 / 16';
	const compositionUrl = project?.compositionUrl;
	const livePreview = Boolean(compositionUrl);
	const exporting = project?.status === 'rendering';
	const progress = Math.max(0, Math.min(100, project?.renderProgress ?? 0));
	const activeQuality = exporting ? (project?.renderQuality ?? quality) : quality;

	useEffect(() => {
		if (!exporting) {
			setElapsed(0);
			return;
		}
		const started = Date.now();
		const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
		return () => window.clearInterval(timer);
	}, [exporting, project?.id, project?.renderQuality]);

	useEffect(() => {
		function onFullscreen() {
			setExpanded(document.fullscreenElement === stageRef.current);
		}
		function onKey(event: KeyboardEvent) {
			if (event.key === 'Escape' && expanded && document.fullscreenElement !== stageRef.current) {
				setExpanded(false);
			}
		}
		document.addEventListener('fullscreenchange', onFullscreen);
		window.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('fullscreenchange', onFullscreen);
			window.removeEventListener('keydown', onKey);
		};
	}, [expanded]);

	async function toggleExpand() {
		const node = stageRef.current;
		if (!node) return;
		if (document.fullscreenElement === node) {
			await document.exitFullscreen().catch(() => setExpanded(false));
			return;
		}
		if (expanded) {
			setExpanded(false);
			return;
		}
		try {
			await node.requestFullscreen();
		} catch {
			setExpanded(true);
		}
	}

	function chooseQuality(next: ExportQuality) {
		setQuality(next);
		localStorage.setItem(QUALITY_KEY, next);
	}

	function seekToFrame(index: number) {
		setFrame(index);
		if (!project || snapshots.length === 0) return;
		const duration = project.duration || playerRef.current?.duration || 0;
		if (!duration) return;
		const time = snapshots.length === 1 ? 0 : (index / (snapshots.length - 1)) * duration;
		playerRef.current?.seek(time);
	}

	return (
		<aside className="preview">
			<header className="preview-header">
				<div>
					<p className="eyebrow">预览</p>
					<h2>{project?.title ?? '未选择项目'}</h2>
				</div>
			</header>
			<div
				className={expanded ? 'stage expanded' : 'stage'}
				ref={stageRef}
				style={{ aspectRatio: expanded ? 'auto' : ratio }}
			>
				{compositionUrl || project?.videoUrl || active ? (
					<button
						className="stage-expand"
						onClick={() => void toggleExpand()}
						type="button"
					>
						{expanded ? '退出' : '全屏'}
					</button>
				) : null}
				{exporting ? (
					<div className="export-overlay" role="status" aria-live="polite">
						<span className="spinner" aria-hidden />
						<p>正在导出{qualityLabel(project?.renderQuality)}，请稍候</p>
						<div className="progress-track">
							<div className={progress > 0 ? 'progress-fill' : 'progress-fill indeterminate'} style={progress > 0 ? { width: `${progress}%` } : undefined} />
						</div>
						<p className="export-meta">
							{progress > 0 ? `${progress}% · ` : ''}
							{stageLabel(project?.renderStage)} · 已用 {elapsed}s
						</p>
					</div>
				) : null}
				{compositionUrl && project ? (
					<CompositionPlayer
						key={compositionUrl}
						height={project.height}
						playerRef={playerRef}
						src={compositionUrl}
						width={project.width}
					/>
				) : project?.videoUrl ? (
					<video controls src={project.videoUrl} />
				) : active ? (
					<img alt="预览帧" src={active} />
				) : (
					<div className="stage-empty">
						<p>还没有预览。先在对话里给话题，脚本和画面做好后，这里会同步播放画面、旁白和字幕。</p>
					</div>
				)}
			</div>
			{livePreview ? (
				<p className="hint">画面、旁白、字幕走同一条时间轴。导出后可下载 MP4。</p>
			) : null}
			{snapshots.length > 0 ? (
				<div className="filmstrip" role="list">
					{snapshots.map((src, index) => (
						<button
							key={src}
							className={index === frame ? 'thumb active' : 'thumb'}
							onClick={() => seekToFrame(index)}
							type="button"
						>
							<img alt={`第 ${index + 1} 帧`} src={src} />
						</button>
					))}
				</div>
			) : null}
			{project ? (
				<VoicePicker
					disabled={busy}
					onApply={onVoiceApply}
					onPreview={onVoicePreview}
					speaker={project.speaker}
				/>
			) : null}
			{project?.error ? <p className="banner error-banner">{project.error}</p> : null}
			{actionError ? <p className="banner error-banner">{actionError}</p> : null}
			{project?.lintSummary ? <p className="lint">{project.lintSummary}</p> : null}
			<div className="actions">
				<button className="ghost" disabled={!project || busy} onClick={() => void onPreview()} type="button">
					刷新预览
				</button>
				<div className="quality-toggle" role="group" aria-label="导出画质">
					<button
						aria-pressed={activeQuality !== 'high'}
						className={activeQuality !== 'high' ? 'active' : undefined}
						disabled={!project || busy}
						onClick={() => chooseQuality('draft')}
						type="button"
					>
						标清
					</button>
					<button
						aria-pressed={activeQuality === 'high'}
						className={activeQuality === 'high' ? 'active' : undefined}
						disabled={!project || busy}
						onClick={() => chooseQuality('high')}
						type="button"
					>
						高清
					</button>
				</div>
				<button
					className="gold"
					disabled={!project || busy}
					onClick={() => void onExport(quality)}
					type="button"
				>
					{exporting ? '导出中…' : '导出'}
				</button>
			</div>
			{project?.videoUrl ? (
				<a
					className="download"
					download={downloadFileName(project.title)}
					href={`${project.videoUrl}${project.videoUrl.includes('?') ? '&' : '?'}download=1`}
				>
					下载 MP4
				</a>
			) : (
				<p className="hint">选好画质后点「导出」，完成后即可下载 MP4。</p>
			)}
		</aside>
	);
}
