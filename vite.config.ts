import { resolve } from 'node:path';
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { defineConfig, build as viteBuild, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { buildSync as esbuildSync } from 'esbuild';
import manifest from './manifest.json';

function contentScriptsBundlePlugin(): Plugin {
  return {
    name: 'yt-lang-ai-content-scripts-fix',
    apply: 'build',
    enforce: 'post',
    async closeBundle() {
      const distDir = resolve(process.cwd(), 'dist');
      const manifestPath = resolve(distDir, 'manifest.json');
      if (!existsSync(manifestPath)) return;

      const builtManifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        content_scripts?: Array<{
          js?: string[];
          world?: string;
          matches?: string[];
          run_at?: string;
        }>;
        web_accessible_resources?: Array<{
          matches?: string[];
          resources?: string[];
          use_dynamic_url?: boolean;
        }>;
      };

      const assetsDir = resolve(distDir, 'assets');

      // 1. Bundle src/injected/interceptor.ts via esbuild as a self-contained IIFE (MAIN world)
      esbuildSync({
        entryPoints: [resolve(process.cwd(), 'src', 'injected', 'interceptor.ts')],
        bundle: true,
        format: 'iife',
        target: 'es2022',
        minify: true,
        pure: ['console.debug'],
        outfile: resolve(assetsDir, 'interceptor-main.js')
      });

      // 2. Bundle src/content/index.ts via viteBuild as a self-contained IIFE (ISOLATED world)
      await viteBuild({
        configFile: false,
        logLevel: 'silent',
        plugins: [react()],
        define: {
          'process.env.NODE_ENV': JSON.stringify('production')
        },
        esbuild: {
          minify: true,
          pure: ['console.debug']
        },
        build: {
          minify: 'esbuild',
          outDir: assetsDir,
          emptyOutDir: false,
          lib: {
            entry: resolve(process.cwd(), 'src', 'content', 'index.ts'),
            name: 'YTLangAIContentScript',
            formats: ['iife'],
            fileName: () => 'content-isolated.js'
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true
            }
          }
        }
      });

      // 3. Point content_scripts directly to self-contained IIFEs
      if (Array.isArray(builtManifest.content_scripts)) {
        for (const cs of builtManifest.content_scripts) {
          if (cs.world === 'MAIN') {
            cs.js = ['assets/interceptor-main.js'];
          } else if (cs.world === 'ISOLATED' || !cs.world) {
            cs.js = ['assets/content-isolated.js'];
          }
        }
      }

      // 4. Force use_dynamic_url: false on web_accessible_resources
      builtManifest.web_accessible_resources = [
        {
          matches: ['*://*.youtube.com/*'],
          resources: ['assets/*', '*.js', '*.css'],
          use_dynamic_url: false
        }
      ];

      writeFileSync(manifestPath, JSON.stringify(builtManifest, null, 2));

      // 5. Remove any CRXJS loader wrappers from dist/assets
      if (existsSync(assetsDir)) {
        for (const file of readdirSync(assetsDir)) {
          if (file.includes('-loader-')) {
            rmSync(resolve(assetsDir, file), { force: true });
          }
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), crx({ manifest }), contentScriptsBundlePlugin()],
  esbuild: {
    pure: ['console.debug']
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild'
  }
});
