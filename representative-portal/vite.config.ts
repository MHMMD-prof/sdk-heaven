import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
