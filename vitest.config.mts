import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: { include: ['lib/**/*.test.ts', 'actions/**/*.test.ts'], environment: 'node' },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
});
