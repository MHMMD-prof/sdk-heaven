import { defineConfig } from 'vite';

export default defineConfig({
  envDir: '..',
  envPrefix: ['VITE_', 'EXPO_PUBLIC_'],
  build: {
    sourcemap: false,
  },
  server: {
    host: 'localhost',
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: 'localhost',
    port: 5174,
    strictPort: true,
  },
});
