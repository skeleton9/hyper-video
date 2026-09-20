import { createAgentRouter } from '@flue/runtime/routing';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { VideoDirector } from './agents/video-director.ts';
import { registerProjectRoutes } from './lib/project-routes.ts';

const app = new Hono();

// Conversation URLs: /api/agents/video-director/<project-id>
app.route('/api/agents/video-director', createAgentRouter(VideoDirector));
registerProjectRoutes(app);

app.use('*', serveStatic({ root: './dist/client' }));
app.get('*', serveStatic({ path: './dist/client/index.html' }));

export default app;
