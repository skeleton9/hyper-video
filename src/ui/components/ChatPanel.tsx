import { type FlueConversationMessage, type FlueConversationPart } from '@flue/react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { STARTER_PROMPTS } from '../lib/format.ts';

export function ChatPanel({
	messages,
	status,
	error,
	busy,
	onSend,
	onStop,
}: {
	messages: FlueConversationMessage[];
	status: string;
	error?: string;
	busy: boolean;
	onSend: (text: string) => Promise<void>;
	onStop: () => Promise<void>;
}) {
	const [input, setInput] = useState('');
	const scroller = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const node = scroller.current;
		if (!node) return;
		node.scrollTop = node.scrollHeight;
	}, [messages, status]);

	async function submit(event: FormEvent) {
		event.preventDefault();
		const text = input.trim();
		if (!text || busy) return;
		setInput('');
		await onSend(text);
	}

	return (
		<section className="chat">
			<header className="chat-header">
				<div>
					<p className="eyebrow">对话</p>
					<h1>短视频工作台</h1>
				</div>
				<span className={`status-pill status-${status}`}>{busy ? '工作中' : '就绪'}</span>
			</header>
			<div className="transcript" ref={scroller}>
				{messages.length === 0 ? (
					<div className="welcome">
						<p>丢一个话题。我会搜集要点、写成口播脚本和分镜，再做成有画面、旁白和字幕的竖屏短视频。</p>
						<div className="prompts">
							{STARTER_PROMPTS.map((prompt) => (
								<button
									key={prompt}
									type="button"
									onClick={() => {
										void onSend(prompt);
									}}
								>
									{prompt}
								</button>
							))}
						</div>
					</div>
				) : (
					messages.map((message) => <Message key={message.id} message={message} />)
				)}
			</div>
			{error ? <p className="banner error-banner">{error}</p> : null}
			<form className="composer" onSubmit={(event) => void submit(event)}>
				<textarea
					value={input}
					onChange={(event) => setInput(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && !event.shiftKey) {
							event.preventDefault();
							event.currentTarget.form?.requestSubmit();
						}
					}}
					placeholder="例如：做一个抖音，讲清楚为什么咖啡因让人失眠"
					rows={2}
				/>
				{busy ? (
					<button className="ghost" onClick={() => void onStop()} type="button">
						停止
					</button>
				) : (
					<button disabled={!input.trim()} type="submit">
						发送
					</button>
				)}
			</form>
		</section>
	);
}

function Message({ message }: { message: FlueConversationMessage }) {
	const visible = message.parts.some((part) => {
		if (part.type === 'text' || part.type === 'reasoning') return Boolean(part.text.trim());
		if (part.type === 'dynamic-tool' || part.type === 'file') return true;
		return false;
	});
	if (!visible && message.role !== 'user') return null;

	return (
		<article className={`message message-${message.role}`}>
			<span className="role">{message.role === 'user' ? '你' : '导演'}</span>
			{message.parts.map((part, index) => (
				<MessagePart key={`${message.id}-${index}`} part={part} />
			))}
		</article>
	);
}

function MessagePart({ part }: { part: FlueConversationPart }) {
	if (part.type === 'text' && part.text.trim()) {
		return <p className="prose">{part.text}</p>;
	}
	if (part.type === 'reasoning' && part.text.trim()) {
		return <details className="reasoning"><summary>思考</summary><p>{part.text}</p></details>;
	}
	if (part.type === 'dynamic-tool') {
		return (
			<p className="tool-chip">
				{toolLabel(part.toolName)} · {toolState(part.state)}
			</p>
		);
	}
	if (part.type === 'file') {
		return part.url ? (
			<a className="file-link" href={part.url}>
				{part.filename ?? '附件'}
			</a>
		) : null;
	}
	return null;
}

function toolLabel(name: string): string {
	switch (name) {
		case 'init_project':
			return '初始化项目';
		case 'fetch_source':
			return '搜集资料';
		case 'save_plan':
			return '保存脚本';
		case 'lint_composition':
			return '检查成片';
		case 'capture_preview':
			return '生成预览';
		case 'generate_voiceover':
			return '配音字幕';
		case 'export_video':
			return '导出视频';
		case 'rename_project':
			return '重命名';
		case 'activate_skill':
			return '加载技能';
		default:
			return name;
	}
}

function toolState(state: string): string {
	if (state.includes('output') || state === 'done' || state === 'output-available') return '完成';
	if (state.includes('error')) return '失败';
	return '进行中';
}
