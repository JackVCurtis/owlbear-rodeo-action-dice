import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `defineConfig` is imported from `vitest/config` so the `test` block is typed
// alongside Vite's own config. The dev server must allow the Owlbear Rodeo
// origin to load our manifest/iframe cross-origin (Vite blocks this by default).
export default defineConfig({
  plugins: [react()],
  server: {
    cors: { origin: 'https://www.owlbear.rodeo' },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
