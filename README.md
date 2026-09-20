# Hyper Video

A [Flue](https://flueframework.com) agent that turns a conversation into a [HyperFrames](https://hyperframes.dev) video, with a three-column studio UI: projects, chat, preview/export.

## Setup

```sh
npm install
```

Add a Volcengine Ark API key to `.env`. This project uses `ark/deepseek-v4-flash-ga-260731`:

```sh
ARK_API_KEY="your-api-key"
ARK_URL="https://ark.cn-beijing.volces.com/api/v3/chat/completions"
ARK_MODEL="deepseek-v4-flash-ga-260731"
```

Preview stills and MP4 export need a local Chrome/Chromium and FFmpeg (HyperFrames CLI).

## Talk to your agent

```sh
npx flue run src/agents/video-director.ts --message "做一个 8 秒金色标题片头"
```

Conversations are durable — pass `--id <id>` to continue one. Each `--id` is also a HyperFrames project under `workspace/projects/<id>/`.

## Develop

```sh
npm run dev
```

Open http://localhost:5173 — left: project list, center: multi-turn chat, right: preview frames and export.

The agent is also at `http://localhost:5173/api/agents/video-director`. After UI edits, re-run `npm run build:ui` (or keep `npm run dev:ui` watching).

## Deploy

```sh
npm run build
node dist/server.mjs
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
