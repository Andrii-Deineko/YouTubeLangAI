import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { buildSync } from 'esbuild';
import manifest from './manifest.json';

function mainWorldInterceptorPlugin(): Plugin {
  return {
    name: 'yt-lang-ai-main-interceptor',
    apply: 'build',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      const outfile = resolve(distDir, 'interceptor.js');
      const publicOutfile = resolve(__dirname, 'public/interceptor.js');

      // 1. Compile src/injected/interceptor.ts into a 100% self-contained IIFE
      // with zero external runtime imports or exports.
      buildSync({
        entryPoints: [resolve(__dirname, 'src/injected/interceptor.ts')],
        outfile,
        bundle: true,
        format: 'iife',
        target: 'es2020',
        minify: false
      });

      // Also copy to public/ for consistency
      buildSync({
        entryPoints: [resolve(__dirname, 'src/injected/interceptor.ts')],
        outfile: publicOutfile,
        bundle: true,
        format: 'iife',
        target: 'es2020',
        minify: false
      });

      // 2. Ensure dist/manifest.json contains the MAIN world content script
      const distManifestPath = resolve(distDir, 'manifest.json');
      const distManifest = JSON.parse(readFileSync(distManifestPath, 'utf-8'));

      if (!distManifest.content_scripts) {
        distManifest.content_scripts = [];
      }

      // Check if MAIN world script is already registered
      const hasMainWorld = distManifest.content_scripts.some(
        (cs: { world?: string }) => cs.world === 'MAIN'
      );

      if (!hasMainWorld) {
        distManifest.content_scripts.unshift({
          matches: ['*://*.youtube.com/*'],
          js: ['interceptor.js'],
          world: 'MAIN',
          run_at: 'document_start'
        });
        writeFileSync(distManifestPath, JSON.stringify(distManifest, null, 2));
      }
    }
  };
}

// Pass to crx() only the parts it should manage (excluding the MAIN world classic script)
const crxManifest = {
  ...manifest,
  content_scripts: manifest.content_scripts.filter((cs: { world?: string }) => cs.world !== 'MAIN')
};

export default defineConfig({
  plugins: [react(), crx({ manifest: crxManifest }), mainWorldInterceptorPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false
  }
});
