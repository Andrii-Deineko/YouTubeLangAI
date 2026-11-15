import { resolve } from 'node:path';
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { buildSync } from 'esbuild';
import manifest from './manifest.json';

function standaloneBundlerPlugin(): Plugin {
  return {
    name: 'yt-lang-ai-standalone-bundler',
    apply: 'build',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      const assetsDir = resolve(distDir, 'assets');
      const distManifestPath = resolve(distDir, 'manifest.json');

      // 1. Build standalone MAIN world interceptor.js (IIFE)
      const interceptorOutfile = resolve(distDir, 'interceptor.js');
      const publicOutfile = resolve(__dirname, 'public/interceptor.js');

      buildSync({
        entryPoints: [resolve(__dirname, 'src/injected/interceptor.ts')],
        outfile: interceptorOutfile,
        bundle: true,
        format: 'iife',
        target: 'es2020',
        banner: {
          js: "console.log('[YT-Lang-AI] MAIN interceptor booted', location.href);"
        },
        minify: false
      });

      buildSync({
        entryPoints: [resolve(__dirname, 'src/injected/interceptor.ts')],
        outfile: publicOutfile,
        bundle: true,
        format: 'iife',
        target: 'es2020',
        banner: {
          js: "console.log('[YT-Lang-AI] MAIN interceptor booted', location.href);"
        },
        minify: false
      });

      // 2. Build standalone ISOLATED world content.js (IIFE) from Vite-processed index.ts chunk
      if (existsSync(assetsDir)) {
        const assetFiles = readdirSync(assetsDir);
        const indexChunk = assetFiles.find(
          (f) => f.startsWith('index.ts-') && !f.includes('loader') && f.endsWith('.js')
        );

        if (indexChunk) {
          const contentOutfile = resolve(distDir, 'content.js');
          buildSync({
            entryPoints: [resolve(assetsDir, indexChunk)],
            outfile: contentOutfile,
            bundle: true,
            format: 'iife',
            target: 'es2020',
            banner: {
              js: "console.log('[YT-Lang-AI] Content script booted', location.href);"
            },
            minify: false
          });

          // Clean up loader files
          const loaderFiles = assetFiles.filter((f) => f.includes('loader'));
          for (const lf of loaderFiles) {
            try {
              rmSync(resolve(assetsDir, lf), { force: true });
            } catch {
              // Ignore
            }
          }
        }
      }

      // 3. Patch dist/manifest.json with direct standalone IIFE scripts and clean web_accessible_resources
      if (existsSync(distManifestPath)) {
        const distManifest = JSON.parse(readFileSync(distManifestPath, 'utf-8'));

        distManifest.content_scripts = [
          {
            matches: ['*://*.youtube.com/*'],
            js: ['interceptor.js'],
            world: 'MAIN',
            run_at: 'document_start'
          },
          {
            matches: ['*://*.youtube.com/*'],
            js: ['content.js'],
            world: 'ISOLATED',
            run_at: 'document_idle'
          }
        ];

        if (Array.isArray(distManifest.web_accessible_resources)) {
          distManifest.web_accessible_resources = distManifest.web_accessible_resources.map(
            (war: Record<string, unknown>) => {
              const { use_dynamic_url, ...rest } = war;
              return { ...rest, use_dynamic_url: false };
            }
          );
        }

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
  plugins: [react(), crx({ manifest: crxManifest }), standaloneBundlerPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false
  }
});
