import { defineConfig } from 'vite';

export default defineConfig({
  base: '/paper-wonderland/',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
});
