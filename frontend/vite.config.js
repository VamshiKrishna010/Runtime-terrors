import { defineConfig } from 'vite';

// The repository-level .env is shared with the backend. Only CONVEX_URL is
// exposed to the browser; GROQ_API_KEY and all other secrets stay private.
export default defineConfig({
  envDir: '..',
  envPrefix: ['VITE_', 'CONVEX_'],
});
