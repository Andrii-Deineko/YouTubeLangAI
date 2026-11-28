# Project Rules & Engineering Guidelines (Mandatory)

## 1. Git Workflow
- **NEVER** commit or push directly to `main`.
- Before writing code for any task, create a new branch from up-to-date `main`:
  - `feat/<short-kebab-description>` — new features, services, and UI improvements
  - `fix/<short-kebab-description>` — bug fixes
  - `refactor/<short-kebab-description>` — architectural changes and code cleanup
  - `docs/<short-kebab-description>` — documentation updates
- Use **Conventional Commits** with package scope where applicable:
  - `feat(service-urplay): ...`, `fix(ui): ...`, `refactor(core): ...`, `docs: ...`, `test(storage): ...`
- **Mandatory pre-commit verification** (must pass with 0 errors):
  ```bash
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
  ```
- Push the feature/fix branch to `origin` (`git push -u origin <branch-name>`) after completing the task and open a PR into `main`.

---

## 2. Monorepo Architecture (`pnpm workspaces`)
This repository uses `pnpm` workspaces with a two-level plugin architecture (`ServicePlugin` × `PlayerPlugin`).

### Strict Dependency Boundaries (enforced by `eslint.config.js`)
- **`@langai/contracts`** (`packages/contracts`) — **0 internal and 0 external dependencies**. Source of truth for all interfaces, message protocols (`LANGAI_MAIN` / `LANGAI_ISOLATED`), settings, and card types.
- **`@langai/subtitle-kit`** (`packages/subtitle-kit`) — may import **only** `@langai/contracts`. Pure subtitle parsing, splitting, tokenization, `SubtitleEngine`, and language utilities (no site DOM dependencies).
- **`@langai/players`** (`packages/players`) — may import **only** `@langai/contracts` and `@langai/subtitle-kit`. Reusable `PlayerPlugin` implementations (`jwplayer`, `playerjs`, `videojs`, `plyr`, `html5`).
- **`@langai/core`**, **`@langai/ui`**, **`@langai/storage`**, **`@langai/translators`** — **NEVER** import `@langai/players`, `@langai/service-*`, or `@langai/extension`, and **NEVER** hardcode player CSS selectors (`#movie_player`, `.jwplayer`, `#oframecdnplayer`) or site domains (`youtube.com`, `netflix.com`, `urplay.se`).
- **`@langai/service-*`** (`packages/services/*`) — may import **only** `@langai/contracts`, `@langai/subtitle-kit`, and `@langai/players`.
- **`@langai/extension`** (`packages/extension`) — the **only** package that imports all `ServicePlugin`s (in `src/registry.ts`) and builds the Chrome MV3 bundle (`packages/extension/dist/`).

### Bundle Hygiene
- Use subpath exports (`@langai/core/background`, `@langai/core/main-world`) for the Service Worker and MAIN-world interceptors so React, Lucide, and CSS never leak into non-UI bundles.
- Never install dependencies with `npm` or commit `package-lock.json`; always use `pnpm`.

---

## 3. Adding a New Streaming Service (`ServicePlugin`)
1. Create `packages/services/<service-id>/` with `package.json`, `tsconfig.json`, and `src/index.ts`.
2. Compose `players` from `@langai/players` (always put `html5PlayerPlugin` last as fallback).
3. Define explicit `hostMatches` and (if needed) `playerIframeMatches`:
   - **NEVER** include `*://*/*`, `<all_urls>`, `localhost`, or `127.0.0.1` in production match patterns.
4. In `initMainWorldExtractor`, the **first statement** must validate the current hostname and `ancestorOrigins` against the service's allowed domains (plus user `customMirrors` if supported) — exit immediately without patching `fetch`/`XHR` or creating `MutationObserver` on non-matching pages.
5. Implement `resolveMediaIdentity` returning a clean `title`, stable `mediaId`, `badgeLabel`, `canonicalUrl`, and optional `buildTimestampUrl`.
6. Register the plugin in `packages/extension/src/registry.ts`, add thin entry files under `packages/extension/src/entries/`, and add the entry to `SERVICE_ENTRIES` in `packages/extension/vite.config.ts`.
7. Add unit tests (`vitest`) covering domain matching, iframe chains, and subtitle extraction.

---

## 4. Code Quality, Security & Performance Standards
- **TypeScript Strictness:** `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true` everywhere. **ZERO** `any`, `@ts-ignore`, or `@ts-expect-error`.
- **Chrome MV3 Security:**
  - Never register dynamic content scripts on `*://*/*` or `<all_urls>` (`moduleManager.ts` enforces this).
  - Keep `use_dynamic_url: true` on `web_accessible_resources`.
  - Keep SSRF protection (blocking loopback/private IPv4/IPv6 ranges), timeout, and size limits on `FETCH_SUBTITLE_TEXT`.
  - Request host permissions explicitly via `chrome.permissions.request` for optional services, custom mirrors, AnkiConnect, and custom/local LLM endpoints (e.g. Ollama).
- **Performance:**
  - Keep `requestAnimationFrame` stopped when video is paused, ended, or tab is hidden (`VideoController`).
  - Avoid DOM reflows (`getComputedStyle` / `getBoundingClientRect`) on already-matched caption nodes during `timeupdate`.
  - Persist translator cooldowns in `chrome.storage.session` (MV3 Service Workers sleep) and always clean up in-flight jobs in `finally`.
- **Storage & State:**
  - Store settings under `langai_settings` and wrap settings/cache mutations with Web Locks API (`withStorageLock`).
  - Store vocabulary cards in IndexedDB `vocabulary_cards` (O(1) single-card `put`) and WebP screenshots as `Blob` in `card_media`.
- **UI & i18n:**
  - Supported UI languages: strictly `UiLanguage = 'en' | 'uk'`. Never hardcode user-facing strings in components — add keys to `packages/ui/src/i18n/translations.ts`.
  - Keep all theme CSS variables in the single source of truth: `packages/ui/src/styles/themes.css`.
  - Keep Popup settings modular under `packages/ui/src/popup/settings/`.
