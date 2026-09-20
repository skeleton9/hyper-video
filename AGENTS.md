# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity.
- `src/app.ts` — the route map; every route is mounted here explicitly.
- `src/db.ts` — the persistence adapter for durable conversations.
- `src/ui/` — React studio (left project list, center chat, right preview/export).
- `workspace/projects/<id>/` — one HyperFrames project per conversation.

## Commands

- `npx flue run src/agents/video-director.ts --message "做一个 30 秒抖音：为什么睡觉前刷手机更睡不着"` — run the agent locally, no server. Requires `ARK_API_KEY` in `.env`.
- `npm run dev` — start the studio at http://localhost:5173.
- `npm run build` — build `dist/server.mjs` and `dist/client` (start it with `npm run start`).
- `npm run check:types` — typecheck.
- `npx flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `npx flue add` — list blueprints for adding channels, sandboxes, and databases.
