import { defineConfig } from 'vite';
import { join } from 'path';

export default defineConfig({
  root: join(__dirname, 'src'),
  base: './',
  build: {
    outDir: join(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
