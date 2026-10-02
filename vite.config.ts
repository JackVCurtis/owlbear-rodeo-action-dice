import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { rebaseManifest } from './src/build/rebaseManifest';

// Served under a subpath on GitHub Pages (set by CI); '/' for local dev.
const base = process.env.BASE_PATH ?? '/';

// public/manifest.json is copied verbatim, so rewrite its root-relative paths to
// include `base` after the bundle is written.
function manifestBase(): Plugin {
  let outDir = 'dist';
  return {
    name: 'manifest-base',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const path = resolve(outDir, 'manifest.json');
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      writeFileSync(path, JSON.stringify(rebaseManifest(manifest, base), null, 2) + '\n');
    },
  };
}

// `defineConfig` is imported from `vitest/config` so the `test` block is typed
// alongside Vite's own config. The dev server must allow the Owlbear Rodeo
// origin to load our manifest/iframe cross-origin (Vite blocks this by default).
export default defineConfig({
  base,
  plugins: [react(), manifestBase()],
  server: {
    cors: { origin: 'https://www.owlbear.rodeo' },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
