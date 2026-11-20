import { defineConfig, type Plugin } from 'vite';
import { FEED_PATH, recordsFeed } from './src/voyage-records/feed';

/**
 * The voyage records as JSON at /voyage-records.json, for bots. The site doesn't link to it.
 * The build writes it as a file; the dev server answers it from the current tables.
 */
function recordsFeedFile(): Plugin {
  const body = () => `${JSON.stringify(recordsFeed(), null, 2)}\n`;
  return {
    name: 'voyage-records-feed',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        // Typed loosely: this project doesn't load Node's types.
        const url = (request as { url?: string }).url;
        if (url?.split('?')[0] !== `/${FEED_PATH}`) return next();
        // Loaded fresh each time, so edits to the record tables show without a restart.
        server.ssrLoadModule('/src/voyage-records/feed.ts').then((feed) => {
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(`${JSON.stringify(feed.recordsFeed(), null, 2)}\n`);
        }, next);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: FEED_PATH, source: body() });
    },
  };
}

export default defineConfig({
  // Relative asset paths so the build works under https://<user>.github.io/<repo>/.
  base: './',
  plugins: [recordsFeedFile()],
});
