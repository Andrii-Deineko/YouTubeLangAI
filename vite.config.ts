import { resolve } from 'node:path';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { defineConfig, build as viteBuild, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

function mainWorldContentScriptFix(): Plugin {
  return {
    name: 'yt-lang-ai-main-world-fix',
    apply: 'build',
    async closeBundle() {
      const distDir = resolve(process.cwd(), 'dist');
      const manifestPath = resolve(distDir, 'manifest.json');
      const builtManifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        content_scripts?: Array<{
          js?: string[];
          world?: string;
        }>;
      };

      const mainEntry = builtManifest.content_scripts?.find((cs) => cs.world === 'MAIN');
      if (!mainEntry) return;

      const loaderFiles = mainEntry.js ?? [];

      // Bundle src/injected/interceptor.ts as a synchronous self-contained IIFE
      // so it executes immediately at document_start in MAIN world without chrome.runtime.getURL
      await viteBuild({
        configFile: false,
        logLevel: 'silent',
        build: {
          outDir: resolve(distDir, 'assets'),
          emptyOutDir: false,
          lib: {
            entry: resolve(process.cwd(), 'src/injected/interceptor.ts'),
            name: 'YTLangAIMainInterceptor',
            formats: ['iife'],
            fileName: () => 'interceptor-main.js'
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true
            }
          }
        }
      });

      mainEntry.js = ['assets/interceptor-main.js'];
      writeFileSync(manifestPath, JSON.stringify(builtManifest, null, 2));

      for (const oldFile of loaderFiles) {
        if (oldFile.includes('interceptor.ts-loader-')) {
          rmSync(resolve(distDir, oldFile), { force: true });
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), crx({ manifest }), mainWorldContentScriptFix()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false
  }
});
