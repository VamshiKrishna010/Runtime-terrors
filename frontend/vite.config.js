import { defineConfig } from 'vite';

// The repository-level .env is shared with the backend. Only CONVEX_URL is
// exposed to the browser; GROQ_API_KEY and all other secrets stay private.
export default defineConfig({
  base: process.env.VITE_DEPLOY_TARGET === 'github-pages'
    ? '/Runtime-terrors/'
    : '/',
  envDir: '..',
  envPrefix: ['VITE_', 'CONVEX_'],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
