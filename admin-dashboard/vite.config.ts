import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: false,
  },
});
