import { defineConfig, loadEnv } from 'vite';
import { existsSync } from 'node:fs';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, '..', ''), ...loadEnv(mode, '.', ''), ...process.env };
  return {
    // GitHub Pages serves the production build from the repository subpath.
    base: env.VITE_DEPLOY_TARGET === 'github-pages' ? '/Runtime-terrors/' : '/',
    envDir: '..',
    envPrefix: ['VITE_'],
    define: { 'import.meta.env.CONVEX_URL': JSON.stringify(env.CONVEX_URL || env.VITE_CONVEX_URL || '') },
    server: {
      host: '0.0.0.0', port: 5173, allowedHosts: ['.trycloudflare.com'],
      proxy: { '/api': {
        target: env.BACKEND_PROXY_TARGET || (existsSync('/.dockerenv') ? 'http://backend:8000' : 'http://127.0.0.1:8000'),
        changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, ''),
      } },
    },
  };
});
