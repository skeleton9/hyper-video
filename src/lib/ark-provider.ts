import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { setProvider } from '@flue/runtime';

const DEFAULT_ARK_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_ARK_MODEL = 'deepseek-v4-flash-ga-260731';

function arkBaseUrl(): string {
	const raw = (process.env.ARK_URL ?? `${DEFAULT_ARK_URL}/chat/completions`).trim();
	return raw.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '') || DEFAULT_ARK_URL;
}

export function arkModelId(): string {
	return process.env.ARK_MODEL?.trim() || DEFAULT_ARK_MODEL;
}

export function arkSpecifier(): string {
	return `ark/${arkModelId()}`;
}

let registered = false;

/** Register once at module load so both `vite dev` and `flue run` can resolve `ark/…`. */
export function registerArkProvider(): void {
	if (registered) return;
	registered = true;

	const modelId = arkModelId();
	const baseUrl = arkBaseUrl();

	setProvider(
		createProvider({
			id: 'ark',
			name: 'Volcengine Ark',
			baseUrl,
			auth: { apiKey: envApiKeyAuth('Volcengine Ark', ['ARK_API_KEY']) },
			models: [
				{
					id: modelId,
					name: modelId,
					api: 'openai-completions',
					provider: 'ark',
					baseUrl,
					reasoning: false,
					input: ['text'],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128_000,
					maxTokens: 8192,
				},
			],
			api: openAICompletionsApi(),
		}),
	);
}

registerArkProvider();
