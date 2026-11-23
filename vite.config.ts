import { resolve } from 'node:path';
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { defineConfig, build as viteBuild, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin';
import { buildSync as esbuildSync } from 'esbuild';

const CINEMA_MATCHES = [
  '*://*.rezka.ag/*',
  '*://rezka.ag/*',
  '*://*.hdrezka.*/*',
  '*://hdrezka.*/*',
  '*://*.9anime.*/*',
  '*://*.hianime.to/*',
  '*://*.megacloud.tv/*',
  '*://*.vidplay.online/*',
  '*://*.filemoon.sx/*',
  '*://*.rabbitstream.net/*'
];

function getTargetConfig(mode: string) {
  if (mode === 'cinema') {
    return {
      target: 'cinema',
      outDir: 'dist-cinema',
      interceptorEntry: resolve(process.cwd(), 'src/entries/interceptor-cinema.ts'),
      contentEntry: resolve(process.cwd(), 'src/entries/content-cinema.ts'),
      manifestName: 'CineLingua - Dual Subtitles for Movies & Anime',
      manifestDesc: 'Learn foreign languages while watching movies, anime, and series with dual subtitles, PlayerJS support, FSRS, and Anki export.',
      contentScripts: [
        {
          matches: CINEMA_MATCHES,
          js: ['src/entries/interceptor-cinema.ts'],
          world: 'MAIN' as const,
          run_at: 'document_start' as const,
          all_frames: true
        },
        {
          matches: CINEMA_MATCHES,
          js: ['src/entries/content-cinema.ts'],
          world: 'ISOLATED' as const,
          run_at: 'document_idle' as const,
          all_frames: true
        }
      ],
      permissions: ['storage', 'unlimitedStorage', 'activeTab', 'scripting'],
      hostPermissions: [
        'https://translate.googleapis.com/*',
        '*://*.rezka.ag/*',
        '*://*.hdrezka.*/*',
        '*://*.9anime.*/*',
        '*://*.hianime.to/*',
        '*://*.megacloud.tv/*',
        '*://*.vidplay.online/*',
        '*://*.filemoon.sx/*',
        '*://*.rabbitstream.net/*'
      ],
      webAccessibleMatches: ['<all_urls>']
    };
  }

  if (mode === 'all') {
    return {
      target: 'all',
      outDir: 'dist-all',
      interceptorEntry: resolve(process.cwd(), 'src/entries/interceptor-all.ts'),
      contentEntry: resolve(process.cwd(), 'src/entries/content-all.ts'),
      manifestName: 'LangAI - Dual Subtitles for YouTube & Online Cinema',
      manifestDesc: 'Universal language learning tool with dual subtitles, Active Listening, FSRS flashcards, and Anki export for YouTube and online cinema streaming platforms.',
      contentScripts: [
        {
          matches: ['*://*.youtube.com/*'],
          js: ['src/entries/interceptor-all.ts'],
          world: 'MAIN' as const,
          run_at: 'document_start' as const,
          all_frames: false
        },
        {
          matches: ['*://*.youtube.com/*'],
          js: ['src/entries/content-all.ts'],
          world: 'ISOLATED' as const,
          run_at: 'document_idle' as const,
          all_frames: false
        },
        {
          matches: CINEMA_MATCHES,
          js: ['src/entries/interceptor-all.ts'],
          world: 'MAIN' as const,
          run_at: 'document_start' as const,
          all_frames: true
        },
        {
          matches: CINEMA_MATCHES,
          js: ['src/entries/content-all.ts'],
          world: 'ISOLATED' as const,
          run_at: 'document_idle' as const,
          all_frames: true
        }
      ],
      permissions: ['storage', 'unlimitedStorage', 'activeTab', 'scripting'],
      hostPermissions: [
        '*://*.youtube.com/*',
        'https://translate.googleapis.com/*',
        '*://*.rezka.ag/*',
        '*://*.hdrezka.*/*',
        '*://*.9anime.*/*',
        '*://*.hianime.to/*',
        '*://*.megacloud.tv/*',
        '*://*.vidplay.online/*',
        '*://*.filemoon.sx/*',
        '*://*.rabbitstream.net/*'
      ],
      webAccessibleMatches: ['<all_urls>']
    };
  }

  // Default: YouTube
  return {
    target: 'youtube',
    outDir: 'dist-youtube',
    interceptorEntry: resolve(process.cwd(), 'src/entries/interceptor-yt.ts'),
    contentEntry: resolve(process.cwd(), 'src/entries/content-yt.ts'),
    manifestName: 'YouTube Lang AI',
    manifestDesc: 'Learn foreign languages on YouTube with dual subtitles, Active Listening mode, contextual AI breakdown, FSRS flashcards, and Anki export.',
    contentScripts: [
      {
        matches: ['*://*.youtube.com/*'],
        js: ['src/entries/interceptor-yt.ts'],
        world: 'MAIN' as const,
        run_at: 'document_start' as const,
        all_frames: false
      },
      {
        matches: ['*://*.youtube.com/*'],
        js: ['src/entries/content-yt.ts'],
        world: 'ISOLATED' as const,
        run_at: 'document_idle' as const,
        all_frames: false
      }
    ],
    permissions: ['storage', 'unlimitedStorage'],
    hostPermissions: [
      '*://*.youtube.com/*',
      'https://translate.googleapis.com/*'
    ],
    webAccessibleMatches: ['*://*.youtube.com/*']
  };
}

function contentScriptsBundlePlugin(targetConfig: ReturnType<typeof getTargetConfig>): Plugin {
  return {
    name: `lang-ai-content-bundle-${targetConfig.target}`,
    apply: 'build',
    enforce: 'post',
    async closeBundle() {
      const distDir = resolve(process.cwd(), targetConfig.outDir);
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

      // 1. Bundle MAIN world interceptor as a self-contained IIFE
      esbuildSync({
        entryPoints: [targetConfig.interceptorEntry],
        bundle: true,
        format: 'iife',
        target: 'es2022',
        minify: true,
        pure: ['console.debug'],
        outfile: resolve(assetsDir, 'interceptor-main.js')
      });

      // 2. Bundle ISOLATED world content script as a self-contained IIFE
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
            entry: targetConfig.contentEntry,
            name: `LangAIContentScript_${targetConfig.target}`,
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
          matches: targetConfig.webAccessibleMatches,
          resources: ['assets/*', '*.js', '*.css'],
          use_dynamic_url: false
        }
      ];

      writeFileSync(manifestPath, JSON.stringify(builtManifest, null, 2));

      // 5. Clean any CRXJS loader wrappers
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

export default defineConfig(({ mode }) => {
  const targetConfig = getTargetConfig(mode);

  const manifest: ManifestV3Export = {
    manifest_version: 3,
    name: targetConfig.manifestName,
    version: '1.0.0',
    description: targetConfig.manifestDesc,
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
      default_title: targetConfig.manifestName
    },
    background: {
      service_worker: 'src/core/background/service-worker.ts',
      type: 'module'
    },
    content_scripts: targetConfig.contentScripts,
    permissions: targetConfig.permissions as any,
    host_permissions: targetConfig.hostPermissions,
    optional_host_permissions: ['http://127.0.0.1/*']
  };

  return {
    plugins: [react(), crx({ manifest }), contentScriptsBundlePlugin(targetConfig)],
    esbuild: {
      pure: ['console.debug']
    },
    build: {
      outDir: targetConfig.outDir,
      emptyOutDir: true,
      sourcemap: false,
      minify: 'esbuild'
    }
  };
});
