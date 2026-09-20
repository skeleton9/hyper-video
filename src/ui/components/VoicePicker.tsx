import { useEffect, useRef, useState } from 'react';
import { fetchVoices, type VoiceOption } from '../lib/api.ts';

export function VoicePicker({
	speaker,
	disabled,
	onApply,
	onPreview,
}: {
	speaker: string | undefined;
	disabled: boolean;
	onApply: (speaker: string) => Promise<void>;
	onPreview: (speaker: string) => Promise<string>;
}) {
	const [voices, setVoices] = useState<VoiceOption[]>([]);
	const [draft, setDraft] = useState(speaker ?? '');
	const [busy, setBusy] = useState<'preview' | 'apply'>();
	const [playing, setPlaying] = useState(false);
	const [error, setError] = useState<string>();
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const selected = draft || speaker || voices[0]?.id || '';
	const current = voices.find((voice) => voice.id === selected);
	const locked = disabled || Boolean(busy);

	useEffect(() => {
		setDraft(speaker ?? '');
	}, [speaker]);

	useEffect(() => {
		void fetchVoices()
			.then(setVoices)
			.catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
		return () => {
			audioRef.current?.pause();
		};
	}, []);

	function stop() {
		audioRef.current?.pause();
		setPlaying(false);
	}

	async function preview() {
		if (!selected || busy) return;
		setError(undefined);
		setBusy('preview');
		try {
			const url = await onPreview(selected);
			const audio = audioRef.current ?? new Audio();
			audioRef.current = audio;
			audio.pause();
			audio.src = url;
			audio.onended = () => setPlaying(false);
			await audio.play();
			setPlaying(true);
		} catch (cause) {
			setPlaying(false);
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(undefined);
		}
	}

	async function apply() {
		if (!selected || busy) return;
		stop();
		setError(undefined);
		setBusy('apply');
		try {
			await onApply(selected);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(undefined);
		}
	}

	return (
		<div className="voice-bar">
			<select
				aria-label="音色"
				disabled={locked || voices.length === 0}
				title={current ? `${current.label} · ${current.hint}` : '音色'}
				value={selected}
				onChange={(event) => {
					stop();
					setDraft(event.target.value);
				}}
			>
				{voices.map((voice) => (
					<option key={voice.id} value={voice.id}>
						{voice.gender === 'male' ? '男' : '女'} · {voice.label}
					</option>
				))}
			</select>
			<button className="ghost" disabled={!selected || locked} onClick={() => void (playing ? stop() : preview())} type="button">
				{busy === 'preview' ? '合成中…' : playing ? '停止' : '试听'}
			</button>
			<button className="use" disabled={!selected || locked} onClick={() => void apply()} type="button">
				{busy === 'apply' ? '使用中…' : '使用'}
			</button>
			{error ? <p className="voice-meta">{error}</p> : null}
		</div>
	);
}
