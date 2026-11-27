import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig, build as viteBuild, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { build as esbuild } from 'esbuild';

const PACKAGE_ROOT = __dirname;
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');
const DIST_DIR = resolve(PACKAGE_ROOT, 'dist');
const ASSETS_DIR = resolve(DIST_DIR, 'assets');

const YOUTUBE_MATCHES = ['*://*.youtube.com/*', '*://youtube.com/*'];

interface ServiceEntrySpec {
  id: string;
  contentEntry: string;
  interceptorEntry?: string;
}

const SERVICE_ENTRIES: readonly ServiceEntrySpec[] = [
  {
    id: 'youtube',
    contentEntry: 'src/entries/content-youtube.ts',
    interceptorEntry: 'src/entries/interceptor-youtube.ts'
  },
  {
    id: 'netflix',
    contentEntry: 'src/entries/content-netflix.ts'
  },
  {
    id: 'urplay',
    contentEntry: 'src/entries/content-urplay.ts',
    interceptorEntry: 'src/entries/interceptor-urplay.ts'
  },
  {
    id: 'hdrezka',
    contentEntry: 'src/entries/content-hdrezka.ts',
    interceptorEntry: 'src/entries/interceptor-hdrezka.ts'
  },
  {
    id: 'hianime',
    contentEntry: 'src/entries/content-hianime.ts',
    interceptorEntry: 'src/entries/interceptor-hianime.ts'
  }
];

function createExtensionManifest(): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: 'YouTube Lang AI - Dual Subtitles & Language Learning',
    version: '2.0.0',
    description:
      'Learn foreign languages on YouTube and streaming services with dual subtitles, contextual AI breakdown, FSRS flashcards, and Anki export.',
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
      service_worker: 'service-worker.js',
      type: 'module'
    },
    content_scripts: [
      {
        matches: YOUTUBE_MATCHES,
        js: ['assets/interceptor-youtube.js'],
        world: 'MAIN',
        run_at: 'document_start',
        all_frames: false
      },
      {
        matches: YOUTUBE_MATCHES,
        js: ['assets/content-youtube.js'],
        world: 'ISOLATED',
        run_at: 'document_idle',
        all_frames: false
      }
    ],
    web_accessible_resources: [
      {
        matches: YOUTUBE_MATCHES,
        resources: ['assets/*.js', 'assets/*.css'],
        use_dynamic_url: true
      }
    ],
    permissions: ['storage', 'unlimitedStorage', 'scripting', 'activeTab'],
    host_permissions: [
      ...YOUTUBE_MATCHES,
      'https://translate.googleapis.com/*',
      'https://api.mymemory.translated.net/*',
      'https://clients5.google.com/*',
      'https://api-free.deepl.com/*',
      'https://api.deepl.com/*'
    ],
    optional_host_permissions: ['https://*/*', 'http://*/*']
  };
}

function buildExtensionBundlesPlugin(): Plugin {
  return {
    name: 'langai-extension-bundles',
    apply: 'build',
    enforce: 'post',
    async closeBundle() {
      mkdirSync(ASSETS_DIR, { recursive: true });

      // 1. Build MV3 Service Worker (ESM)
      await esbuild({
        entryPoints: [resolve(PACKAGE_ROOT, 'src/entries/service-worker.ts')],
        bundle: true,
        format: 'esm',
        target: 'es2022',
        minify: true,
        pure: ['console.debug'],
        outfile: resolve(DIST_DIR, 'service-worker.js')
      });

      // 2. Build all MAIN-world interceptors as self-contained IIFEs
      await Promise.all(
        SERVICE_ENTRIES.filter((spec) => Boolean(spec.interceptorEntry)).map((spec) =>
          esbuild({
            entryPoints: [resolve(PACKAGE_ROOT, spec.interceptorEntry as string)],
            bundle: true,
            format: 'iife',
            target: 'es2022',
            minify: true,
            pure: ['console.debug'],
            outfile: resolve(ASSETS_DIR, `interceptor-${spec.id}.js`)
          })
        )
      );

      // 3. Build all ISOLATED content scripts as self-contained IIFEs via Vite
      //    (supports React + CSS ?inline imports from @langai/ui with zero orphan chunks)
      for (const spec of SERVICE_ENTRIES) {
        await viteBuild({
          configFile: false,
          root: PACKAGE_ROOT,
          logLevel: 'silent',
          plugins: [react()],
          css: {
            postcss: resolve(PACKAGE_ROOT, 'postcss.config.js')
          },
          define: {
            'process.env.NODE_ENV': JSON.stringify('production')
          },
          esbuild: {
            minify: true,
            pure: ['console.debug']
          },
          build: {
            minify: 'esbuild',
            outDir: ASSETS_DIR,
            emptyOutDir: false,
            cssCodeSplit: false,
            lib: {
              entry: resolve(PACKAGE_ROOT, spec.contentEntry),
              name: `LangAIContent_${spec.id}`,
              formats: ['iife'],
              fileName: () => `content-${spec.id}.js`
            },
            rollupOptions: {
              output: {
                inlineDynamicImports: true
              }
            }
          }
        });
      }

      // 4. Write Manifest V3
      writeFileSync(
        resolve(DIST_DIR, 'manifest.json'),
        JSON.stringify(createExtensionManifest(), null, 2) + '\n',
        'utf-8'
      );
    }
  };
}

export default defineConfig({
  root: PACKAGE_ROOT,
  publicDir: resolve(REPO_ROOT, 'public'),
  plugins: [react(), buildExtensionBundlesPlugin()],
  css: {
    postcss: resolve(PACKAGE_ROOT, 'postcss.config.js')
  },
  esbuild: {
    pure: ['console.debug']
  },
  build: {
    outDir: DIST_DIR,
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        popup: resolve(PACKAGE_ROOT, 'src/popup/index.html')
      }
    }
  }
});
