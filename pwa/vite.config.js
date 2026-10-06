import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import nodepod from '@r1ck404/nodepod/vite';

const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  plugins: [vue(), nodepod()],
  build: { target: 'esnext', outDir: 'dist' },
  optimizeDeps: { exclude: ['@r1ck404/nodepod'] },
});
