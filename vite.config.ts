import { resolve } from 'node:path';
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { defineConfig, build as viteBuild, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin';
import { buildSync as esbuildSync } from 'esbuild';

const YOUTUBE_MATCHES = ['*://*.youtube.com/*', '*://youtube.com/*'];

function unifiedContentBundlePlugin(): Plugin {
  return {
    name: 'lang-ai-unified-content-bundle',
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
          all_frames?: boolean;
        }>;
        web_accessible_resources?: Array<{
          matches?: string[];
          resources?: string[];
          use_dynamic_url?: boolean;
        }>;
      };

      const assetsDir = resolve(distDir, 'assets');

      // 1. Bundle YouTube MAIN interceptor as self-contained IIFE
      esbuildSync({
        entryPoints: [resolve(process.cwd(), 'src/entries/interceptor-yt.ts')],
        bundle: true,
        format: 'iife',
        target: 'es2022',
        minify: true,
        pure: ['console.debug'],
        outfile: resolve(assetsDir, 'interceptor-yt.js')
      });

      // 2. Bundle YouTube ISOLATED content script as self-contained IIFE
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
            entry: resolve(process.cwd(), 'src/entries/content-yt.ts'),
            name: 'LangAIContentScript_YouTube',
            formats: ['iife'],
            fileName: () => 'content-yt.js'
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true
            }
          }
        }
      });

      // 3. Bundle Cinema MAIN interceptor as self-contained IIFE
      esbuildSync({
        entryPoints: [resolve(process.cwd(), 'src/entries/interceptor-cinema.ts')],
        bundle: true,
        format: 'iife',
        target: 'es2022',
        minify: true,
        pure: ['console.debug'],
        outfile: resolve(assetsDir, 'interceptor-cinema.js')
      });

      // 4. Bundle Cinema ISOLATED content script as self-contained IIFE
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
            entry: resolve(process.cwd(), 'src/entries/content-cinema.ts'),
            name: 'LangAIContentScript_Cinema',
            formats: ['iife'],
            fileName: () => 'content-cinema.js'
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true
            }
          }
        }
      });

      // 5. Point static content_scripts directly to self-contained YouTube IIFEs
      if (Array.isArray(builtManifest.content_scripts)) {
        for (const cs of builtManifest.content_scripts) {
          if (cs.world === 'MAIN') {
            cs.js = ['assets/interceptor-yt.js'];
          } else if (cs.world === 'ISOLATED' || !cs.world) {
            cs.js = ['assets/content-yt.js'];
          }
        }
      }

      // 6. Force use_dynamic_url: false on web_accessible_resources
      builtManifest.web_accessible_resources = [
        {
          matches: ['<all_urls>'],
          resources: ['assets/*', '*.js', '*.css'],
          use_dynamic_url: false
        }
      ];

      writeFileSync(manifestPath, JSON.stringify(builtManifest, null, 2));

      // 7. Clean any CRXJS loader wrappers
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

export default defineConfig(() => {
  const manifest: ManifestV3Export = {
    manifest_version: 3,
    name: 'YouTube Lang AI - Dual Subtitles & Language Learning',
    version: '1.0.0',
    description: 'Learn foreign languages on YouTube and streaming cinema with dual subtitles, contextual AI breakdown, FSRS flashcards, and Anki export.',
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png'
    },
    action: {
      default_popup: 'src/popup/index.html',
      default_icon: {
        '16': 'icons/icon16.png',
        '48': 'icons/icon48.png',
        '128': 'icons/icon128.png'
      },
      default_title: 'YouTube Lang AI'
    },
    background: {
      service_worker: 'src/core/background/service-worker.ts',
      type: 'module'
    },
    content_scripts: [
      {
        matches: YOUTUBE_MATCHES,
        js: ['src/entries/interceptor-yt.ts'],
        world: 'MAIN',
        run_at: 'document_start',
        all_frames: false
      },
      {
        matches: YOUTUBE_MATCHES,
        js: ['src/entries/content-yt.ts'],
        world: 'ISOLATED',
        run_at: 'document_idle',
        all_frames: false
      }
    ],
    permissions: ['storage', 'unlimitedStorage', 'scripting'],
    host_permissions: [
      ...YOUTUBE_MATCHES,
      'https://translate.googleapis.com/*'
    ],
    optional_host_permissions: [
      'https://*/*',
      'http://*/*'
    ]
  };

  return {
    plugins: [react(), crx({ manifest }), unifiedContentBundlePlugin()],
    esbuild: {
      pure: ['console.debug']
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      minify: 'esbuild'
    }
  };
});
