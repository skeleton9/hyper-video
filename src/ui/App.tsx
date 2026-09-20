import { useFlueAgent } from '@flue/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatPanel } from './components/ChatPanel.tsx';
import { PreviewPanel } from './components/PreviewPanel.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import {
	abortConversation,
	createProject,
	deleteProject,
	fetchProject,
	fetchProjects,
	previewVoice,
	requestExport,
	requestPreview,
	applyProjectVoice,
	type ProjectRecord,
} from './lib/api.ts';
import { conversationUrl, latestStudio } from './lib/format.ts';

const STORAGE_KEY = 'hyper-video:project-id';

export function App() {
	const [projects, setProjects] = useState<ProjectRecord[]>([]);
	const [selectedId, setSelectedId] = useState<string | undefined>(
		() => localStorage.getItem(STORAGE_KEY) ?? undefined,
	);
	const [pendingMessage, setPendingMessage] = useState<string>();
	const [bootError, setBootError] = useState<string>();
	const [actionError, setActionError] = useState<string>();
	const [sending, setSending] = useState(false);
	const [voiceBusy, setVoiceBusy] = useState(false);

	const agent = useFlueAgent({ url: selectedId ? conversationUrl(selectedId) : undefined });
	const studio = useMemo(() => latestStudio(agent.messages), [agent.messages]);
	const selected = projects.find((project) => project.id === selectedId);

	const deletedIds = useRef(new Set<string>());
	const pendingSent = useRef<string | undefined>(undefined);
	const exportLock = useRef(false);

	const refreshList = useCallback(async (preferId?: string, createIfEmpty = true) => {
		let list = await fetchProjects();
		if (list.length === 0 && createIfEmpty) {
			const created = await createProject({ title: '未命名项目', resolution: 'portrait' });
			list = [created];
			preferId = created.id;
		}
		setProjects(list);
		setSelectedId((current) => {
			const next = preferId ?? current ?? list[0]?.id;
			return next && list.some((project) => project.id === next) ? next : list[0]?.id;
		});
	}, []);

	useEffect(() => {
		void refreshList().catch((error: unknown) => {
			setBootError(error instanceof Error ? error.message : String(error));
		});
	}, [refreshList]);

	useEffect(() => {
		if (selectedId) localStorage.setItem(STORAGE_KEY, selectedId);
		else localStorage.removeItem(STORAGE_KEY);
	}, [selectedId]);

	useEffect(() => {
		if (!studio) return;
		if (deletedIds.current.has(studio.projectId)) return;
		setProjects((current) => {
			const index = current.findIndex((project) => project.id === studio.projectId);
			const previous = current[index];
			const keepRendering =
				previous?.status === 'rendering' && studio.status !== 'exported' && studio.status !== 'error';
			const next: ProjectRecord = {
				id: studio.projectId,
				title: studio.title,
				createdAt: previous?.createdAt ?? new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				status: keepRendering ? 'rendering' : studio.status,
				resolution: previous?.resolution ?? 'landscape',
				width: studio.width,
				height: studio.height,
				duration: studio.duration,
				error: studio.error,
				lintSummary: studio.lintSummary,
				snapshots: studio.snapshots,
				videoUrl: studio.videoUrl,
				speaker: studio.speaker ?? previous?.speaker,
				voiceUrl: studio.voiceUrl ?? previous?.voiceUrl,
				captionCount: studio.captionCount ?? previous?.captionCount,
				hasComposition: studio.hasComposition ?? previous?.hasComposition,
				compositionUrl: studio.compositionUrl ?? previous?.compositionUrl,
				renderQuality: previous?.renderQuality,
				renderProgress: previous?.renderProgress,
				renderStage: previous?.renderStage,
			};
			if (index === -1) return [next, ...current];
			const copy = [...current];
			copy[index] = { ...current[index], ...next };
			return copy;
		});
	}, [studio]);

	useEffect(() => {
		if (!selectedId || selected?.status !== 'rendering') return;
		const timer = window.setInterval(() => {
			void fetchProject(selectedId)
				.then((project) => {
					setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
				})
				.catch(() => undefined);
		}, 1000);
		return () => window.clearInterval(timer);
	}, [selected?.status, selectedId]);

	useEffect(() => {
		if (!pendingMessage || !selectedId || !agent.historyReady) return;
		if (pendingSent.current === `${selectedId}:${pendingMessage}`) return;
		pendingSent.current = `${selectedId}:${pendingMessage}`;
		const text = pendingMessage;
		setPendingMessage(undefined);
		setSending(true);
		void agent
			.sendMessage(text)
			.catch((error: unknown) => {
				setActionError(error instanceof Error ? error.message : String(error));
			})
			.finally(() => setSending(false));
	}, [agent.historyReady, agent.sendMessage, pendingMessage, selectedId]);

	const busy =
		sending ||
		Boolean(pendingMessage) ||
		agent.status === 'submitted' ||
		agent.status === 'streaming' ||
		selected?.status === 'rendering' ||
		voiceBusy;

	async function handleCreate() {
		setActionError(undefined);
		const project = await createProject({ title: '未命名项目', resolution: 'portrait' });
		await refreshList(project.id);
	}

	async function handleDelete(id: string) {
		const project = projects.find((item) => item.id === id);
		const title = project?.title?.trim() || '该项目';
		if (!window.confirm(`确定删除「${title}」？对话、成片和素材都会被去掉，且无法恢复。`)) return;
		setActionError(undefined);
		deletedIds.current.add(id);
		try {
			if (id === selectedId) await abortConversation(id).catch(() => undefined);
			await deleteProject(id);
			const list = await fetchProjects();
			setProjects(list);
			setSelectedId((current) => {
				if (current !== id) return current;
				return list[0]?.id;
			});
		} catch (error) {
			deletedIds.current.delete(id);
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	async function handleSend(text: string) {
		setActionError(undefined);
		if (!selectedId) {
			setPendingMessage(text);
			await refreshList();
			return;
		}
		setSending(true);
		try {
			await agent.sendMessage(text);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setSending(false);
		}
	}

	async function handleStop() {
		if (!selectedId) return;
		await abortConversation(selectedId);
	}

	async function handlePreview() {
		if (!selectedId) return;
		setActionError(undefined);
		try {
			const project = await requestPreview(selectedId);
			setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	async function handleVoiceApply(speaker: string) {
		if (!selectedId) return;
		setActionError(undefined);
		setVoiceBusy(true);
		try {
			const project = await applyProjectVoice(selectedId, speaker);
			setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
			throw error;
		} finally {
			setVoiceBusy(false);
		}
	}

	async function handleExport(quality: 'draft' | 'high') {
		if (!selectedId || exportLock.current) return;
		exportLock.current = true;
		setActionError(undefined);
		setProjects((current) =>
			current.map((item) =>
				item.id === selectedId
					? { ...item, status: 'rendering', renderQuality: quality, renderProgress: 0, renderStage: '准备中', error: undefined }
					: item,
			),
		);
		try {
			const project = await requestExport(selectedId, quality);
			setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
			setProjects((current) =>
				current.map((item) =>
					item.id === selectedId ? { ...item, status: item.videoUrl ? 'exported' : 'error' } : item,
				),
			);
		} finally {
			exportLock.current = false;
		}
	}

	return (
		<div className="shell">
			<Sidebar
				busy={busy}
				onCreate={() => void handleCreate()}
				onDelete={(id) => handleDelete(id)}
				onSelect={setSelectedId}
				projects={projects}
				selectedId={selectedId}
			/>
			<ChatPanel
				busy={busy}
				error={bootError ?? actionError ?? agent.error?.message}
				messages={agent.messages}
				onSend={handleSend}
				onStop={handleStop}
				status={agent.status}
			/>
			<PreviewPanel
				actionError={actionError}
				busy={busy}
				onExport={handleExport}
				onPreview={handlePreview}
				onVoiceApply={handleVoiceApply}
				onVoicePreview={previewVoice}
				project={selected}
			/>
		</div>
	);
}
