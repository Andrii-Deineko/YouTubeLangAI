import type { UiLanguage } from '@langai/contracts';

export interface UiTranslationStrings {
  // Popup navigation & header
  appTitle: string;
  wordsDue: (words: number, due: number) => string;
  fullscreen: string;
  openFullscreenTrainer: string;
  tabTrainer: string;
  tabVocabulary: string;
  tabSettings: string;
  loadingWorkspace: string;

  // Trainer & Vocabulary
  allSources: string;
  emptyVocabTitle: string;
  emptyVocabDescPrefix: string;
  emptyVocabSaveBtn: string;
  emptyVocabOrPress: string;
  allCaughtUp: string;
  completedReviews: (count: number) => string;
  savedCardsCount: (count: number) => string;
  practiceAllAnyway: string;
  freePractice: string;
  dueQueue: string;
  exitFreePractice: string;
  noContextSentence: string;
  showAnswerSpace: string;
  lemmaLabel: string;
  ratingAgain: string;
  ratingHard: string;
  ratingGood: string;
  ratingEasy: string;
  searchPlaceholder: string;
  filterAll: string;
  filterDue: string;
  filterNew: string;
  filterLearning: string;
  filterReview: string;
  noCardsMatch: string;
  copied: string;
  tgCopy: string;
  csvBtn: string;
  ankiConnectBtn: string;
  telegramBtn: string;
  openSourcePage: string;
  deleteCard: string;
  ankiPermissionDenied: string;
  ankiExportPartial: (added: number, skipped: number, firstError: string) => string;
  ankiExportSuccess: (added: number, skipped: number) => string;
  ankiExportFailed: string;

  // Settings — Platform Modules
  platformModules: string;
  modularSystem: string;
  builtInBadge: string;
  activeBadge: string;
  disabledBadge: string;
  builtInServiceDesc: string;
  dynamicServiceDesc: (hosts: string) => string;
  servicePermissionDenied: (name: string) => string;
  serviceToggleFailed: (name: string) => string;
  siteAllowed: string;
  siteNeedsPerm: string;
  restartScript: string;
  enableOnSite: string;
  sitePermissionDenied: (host: string) => string;

  // Settings — App Language
  appLanguageTitle: string;
  appLanguageDesc: string;

  // Settings — Mini-Tabs & Group Headings
  subTabGeneral: string;
  subTabStyle: string;
  subTabPlayer: string;
  subTabKeys: string;
  subTabIntegrations: string;
  livePreviewLabel: string;
  trackSizesTitle: string;
  typographyTitle: string;
  behaviorTogglesTitle: string;
  primaryShort: string;
  transShort: string;
  primaryTrackTitle: string;
  transTrackTitle: string;
  primaryTrackHint: string;
  transTrackHint: string;
  resetTo20px: string;
  resetTo17px: string;

  // Settings — Appearance & Subtitles
  appearanceSubtitles: string;
  colorTheme: string;
  popupScaleTitle: string;
  popupScaleHint: string;
  subtitleFontSize: string;
  standardLabel: string;
  overlayOpacity: string;
  transparentLabel: string;
  solidLabel: string;
  activeListeningTitle: string;
  modeNormal: string;
  modeNormalDesc: string;
  modeBlur: string;
  modeBlurDesc: string;
  modeStealth: string;
  modeStealthDesc: string;
  controlsScaleTitle: string;
  controlsCompact: string;
  controlsStandard: string;
  controlsLarge: string;
  controlsMax: string;
  subtitlePosition: string;
  posCustom: (x: number, y: number) => string;
  posDefault: string;
  resetBtn: string;
  dragHint: string;

  // Settings — Languages & Behavior
  langAndBehavior: string;
  translationDirection: string;
  reverseTag: string;
  smartSwitchTag: string;
  reverseBtn: string;
  reverseBtnTitle: string;
  targetLangLabel: string;
  sourceLangLabel: string;
  secondaryLangLabel: string;
  secondaryLangHint: string;
  toggleOverlay: string;
  toggleDual: string;
  toggleAutoHide: string;
  toggleAltHold: string;
  toggleAutoPauseCue: string;
  togglePauseOnWord: string;
  pauseTimerTitle: string;
  offLabel: string;
  secShort: string;
  secWord: string;

  // Settings — Hotkeys
  hotkeysTitle: string;
  hotkeysResetTitle: string;
  keyConflict: string;
  pressKey: string;
  clearHotkey: string;

  // Settings — Translation Provider
  subtitleTranslationTitle: string;
  subtitleTranslationDesc: string;
  myMemoryEmailLabel: string;
  myMemoryEmailPlaceholder: string;
  deeplKeyPlaceholder: string;
  hideKey: string;
  showKey: string;

  // Settings — LLM BYOK & Anki
  aiProviderTitle: string;
  baseUrlLabel: string;
  apiKeyLabel: string;
  modelLabel: string;
  loadedSuffix: string;
  pickFromList: string;
  enterManually: string;
  notInList: string;
  refreshModels: string;
  chooseBtn: string;
  fallbackModelLabel: string;
  doNotUse: string;
  currentTag: string;
  fallbackPlaceholder: string;
  fallbackHint: string;
  resolvedEndpoint: string;
  testLlmBtn: string;
  llmPermissionDenied: (origin: string) => string;
  ankiAndCache: string;
  ankiUrlLabel: string;
  ankiDeckLabel: string;
  testAnkiBtn: string;
  ankiConnected: (version: number) => string;
  cacheCleared: string;
  clearCacheBtn: string;

  // PlayerControls
  disableExt: string;
  enableExt: string;
  retryNow: string;
  captionRateLimitedTooltip: string;
  translationCooldownTooltip: (sec: number) => string;
  translationUnavailableTooltip: string;
  trackDual: string;
  trackDualDesc: string;
  trackDualTooltip: string;
  trackTransOnly: string;
  trackTransOnlyDesc: string;
  trackTransOnlyTooltip: string;
  trackOrigOnly: string;
  trackOrigOnlyDesc: string;
  trackOrigOnlyTooltip: string;
  translationDirectionTooltip: (src: string, tgt: string) => string;
  sourceLangSelectTooltip: (label: string) => string;
  reverseTranslationTooltip: (src: string, tgt: string) => string;
  targetLangSelectTooltip: (label: string, smart: boolean) => string;
  sourceLangHeader: string;
  targetLangHeader: string;
  listenNormal: string;
  listenNormalDesc: string;
  listenNormalTooltip: string;
  listenBlur: string;
  listenBlurDesc: string;
  listenBlurTooltip: string;
  listenStealth: string;
  listenStealthDesc: string;
  listenStealthTooltip: string;
  autoPauseTimerOnTooltip: (sec: number) => string;
  autoPauseOnTooltip: string;
  autoPauseOffTooltip: string;
  timerOffTitle: string;
  timerOffDesc: string;
  timerManualTitle: string;
  timerManualDesc: string;
  timerSecTitle: (s: number) => string;
  timerSecDesc: (s: number) => string;
  timerCustomTitle: string;
  timerCustomDesc: string;
  pauseManualLabel: string;
  repeatCueTooltip: string;
  fontStyleTooltip: (px: number) => string;
  resetSizePosTooltip: string;
  systemMenuTooltip: string;
  compactBadgeTitle: string;
  overflowBadgeTitle: string;
  detentPullHint: string;
  wordClickPauseTitle: (on: boolean) => string;
  wordClickPauseOnDesc: string;
  wordClickPauseOffDesc: string;
  fontSizeTitle: string;
  transSizeTitle: string;
  fontFamilyTitle: string;
  fontWeightTitle: string;
  weightNormal: string;
  weightBold: string;
  outlineTitle: string;
  outlineNone: string;
  outlineShadow: string;
  outlineStroke: string;
  backdropTitle: string;
  staticBoxTitle: string;
  resetSizeBtn: string;
  resetStyleBtn: string;
  autoPauseCountdown: (s: number) => string;
  resumeNowTitle: string;

  // SubtitleOverlay
  dragTooltip: string;
  lockOnTooltip: string;
  lockOffTooltip: string;
  altOriginalHint: string;
  blurHint: string;
  stealthHint: string;
  retryingTranslation: string;

  // WordPopup
  pronounce: string;
  closeEsc: string;
  translating: string;
  translationError: string;
  extensionUpdatedReload: string;
  emptyWorkerResponse: string;
  subtitleContext: string;
  pronounceSentence: string;
  loadingContextTrans: string;
  aiBreakdownBtn: string;
  connectAiBtn: string;
  analyzingContext: string;
  aiExplanationFailed: string;
  aiMissingKeyTitle: string;
  aiMissingKeyDesc: string;
  aiOverloadedTitle: string;
  aiOverloadedDesc: string;
  aiRateLimitTitle: string;
  aiRateLimitDesc: string;
  configureAi: string;
  retryBtn: string;
  aiBreakdownHeader: string;
  literalLabel: string;
  grammarLabel: string;
  nuanceLabel: string;
  examplesLabel: string;
  popupShortcuts: string;
  savedBtn: string;
  saveWordBtn: string;
}

export const UI_TRANSLATIONS: Record<UiLanguage, UiTranslationStrings> = {
  en: {
    // Popup navigation & header
    appTitle: 'YouTube Lang AI',
    wordsDue: (words: number, due: number) => `${words} words · ${due} due for review`,
    fullscreen: 'Fullscreen',
    openFullscreenTrainer: 'Open fullscreen trainer',
    tabTrainer: 'Trainer',
    tabVocabulary: 'Vocabulary',
    tabSettings: 'Settings',
    loadingWorkspace: 'Loading workspace...',

    // Trainer & Vocabulary
    allSources: 'All sources',
    emptyVocabTitle: 'Your vocabulary is empty',
    emptyVocabDescPrefix: 'Open any video with subtitles, click on unfamiliar words, and press',
    emptyVocabSaveBtn: 'Save word',
    emptyVocabOrPress: 'or press',
    allCaughtUp: 'All caught up!',
    completedReviews: (count: number) =>
      `Completed ${count} review${count === 1 ? '' : 's'} this session. `,
    savedCardsCount: (count: number) =>
      `You have ${count} saved card${count === 1 ? '' : 's'} in this deck.`,
    practiceAllAnyway: 'Practice all cards anyway',
    freePractice: 'Free Practice',
    dueQueue: 'Due Queue',
    exitFreePractice: 'Exit Free Practice',
    noContextSentence: 'No context sentence recorded.',
    showAnswerSpace: 'Show answer (Space)',
    lemmaLabel: 'Lemma:',
    ratingAgain: 'Again',
    ratingHard: 'Hard',
    ratingGood: 'Good',
    ratingEasy: 'Easy',
    searchPlaceholder: 'Search word, translation, sentence, video...',
    filterAll: 'All',
    filterDue: 'Due',
    filterNew: 'New',
    filterLearning: 'Learning',
    filterReview: 'Review',
    noCardsMatch: 'No vocabulary cards match your filter.',
    copied: 'Copied',
    tgCopy: 'TG Copy',
    csvBtn: 'CSV (UTF-8)',
    ankiConnectBtn: 'AnkiConnect',
    telegramBtn: 'Telegram',
    openSourcePage: 'Open video page',
    deleteCard: 'Delete card',
    ankiPermissionDenied: 'Permission for local AnkiConnect host was denied.',
    ankiExportPartial: (added: number, skipped: number, firstError: string) =>
      `Added ${added}, skipped ${skipped}, errors: ${firstError}`,
    ankiExportSuccess: (added: number, skipped: number) =>
      `Anki export complete: ${added} added, ${skipped} duplicates skipped.`,
    ankiExportFailed: 'AnkiConnect export failed',

    // Settings — Platform Modules
    platformModules: 'Platform Modules',
    modularSystem: 'Modular system',
    builtInBadge: 'Built-in',
    activeBadge: 'Active',
    disabledBadge: 'Disabled',
    builtInServiceDesc: 'Built-in core platform module',
    dynamicServiceDesc: (hosts: string) =>
      hosts ? `Optional module (${hosts})` : 'Optional dynamic platform module',
    servicePermissionDenied: (name: string) => `Host permission is required for ${name}`,
    serviceToggleFailed: (name: string) => `Failed to toggle ${name}`,
    siteAllowed: 'Site permission granted',
    siteNeedsPerm: 'Permission required for current site',
    restartScript: 'Restart script',
    enableOnSite: 'Enable on this site',
    sitePermissionDenied: (host: string) => `Access to ${host} was denied`,

    // Settings — App Language
    appLanguageTitle: 'App Language',
    appLanguageDesc: 'Interface language (system logs always remain in English)',

    // Settings — Mini-Tabs & Group Headings
    subTabGeneral: 'General',
    subTabStyle: 'Style',
    subTabPlayer: 'Player',
    subTabKeys: 'Hotkeys',
    subTabIntegrations: 'AI · Anki',
    livePreviewLabel: 'Live Preview',
    trackSizesTitle: 'Track Sizes (px)',
    typographyTitle: 'Typography & Backdrop',
    behaviorTogglesTitle: 'Player Behavior',
    primaryShort: 'Orig',
    transShort: 'Trns',
    primaryTrackTitle: 'Original',
    transTrackTitle: 'Translation',
    primaryTrackHint: 'Primary subtitle size (12–56px). Click number to reset to 20px.',
    transTrackHint: 'Translation size (12–48px). Click number to reset to 17px.',
    resetTo20px: 'Reset to 20px',
    resetTo17px: 'Reset to 17px',

    // Settings — Appearance & Subtitles
    appearanceSubtitles: 'Appearance & Subtitles',
    colorTheme: 'Color Theme',
    popupScaleTitle: 'Widget Zoom',
    popupScaleHint: 'Scales popup text and window independently of browser font size',
    subtitleFontSize: 'Subtitle Font Size',
    standardLabel: 'Standard',
    overlayOpacity: 'Subtitle Backdrop Opacity',
    transparentLabel: 'Transparent',
    solidLabel: 'Solid',
    activeListeningTitle: 'Active Listening Mode',
    modeNormal: 'Normal',
    modeNormalDesc: 'Always visible',
    modeBlur: 'Blur',
    modeBlurDesc: 'Hover or Alt',
    modeStealth: 'Stealth',
    modeStealthDesc: 'Hold Alt only',
    controlsScaleTitle: 'Player Controls Size',
    controlsCompact: 'Compact (S · 85%)',
    controlsStandard: 'Standard (M · 100%)',
    controlsLarge: 'Large (L · 125%)',
    controlsMax: 'Max (XL · 150%)',
    subtitlePosition: 'Subtitle Position',
    posCustom: (x: number, y: number) => `Custom (${x}%, ${y}%)`,
    posDefault: 'Bottom center (default)',
    resetBtn: 'Reset',
    dragHint: 'Drag subtitle box',

    // Settings — Languages & Behavior
    langAndBehavior: 'Languages & Player Behavior',
    translationDirection: 'Translation Direction',
    reverseTag: 'Reversed',
    smartSwitchTag: 'Smart',
    reverseBtn: 'Reverse',
    reverseBtnTitle: 'Swap translation direction back and forth',
    targetLangLabel: 'Target Language (Native)',
    sourceLangLabel: 'Video Source Language',
    secondaryLangLabel: 'Secondary Language (Auto-Reverse)',
    secondaryLangHint:
      'If the subtitle track matches your target language, translation automatically switches to the secondary language.',
    toggleOverlay: 'Enable subtitles and player toolbar (Overlay)',
    toggleDual: 'Show dual (translated) subtitles',
    toggleAutoHide: 'Auto-hide toolbar when inactive',
    toggleAltHold: 'Auto-pause while holding Alt (resume on release)',
    toggleAutoPauseCue: 'Auto-pause at the end of every subtitle cue',
    togglePauseOnWord: 'Pause playback when clicking a word',
    pauseTimerTitle: 'Auto-Pause Resume Timer',
    offLabel: 'Off',
    secShort: 's',
    secWord: 'sec',

    // Settings — Hotkeys
    hotkeysTitle: 'Keyboard Shortcuts',
    hotkeysResetTitle: 'Reset all keyboard shortcuts to default',
    keyConflict: 'Key conflict',
    pressKey: 'Press a key...',
    clearHotkey: 'Clear shortcut',

    // Settings — Translation Provider
    subtitleTranslationTitle: 'Subtitle Translation',
    subtitleTranslationDesc: 'Shared provider across all video platforms',
    myMemoryEmailLabel: 'Contact email — optional',
    myMemoryEmailPlaceholder: 'Email for 50,000 chars/day quota',
    deeplKeyPlaceholder: 'Enter DeepL API Free key',
    hideKey: 'Hide key',
    showKey: 'Show key',

    // Settings — LLM BYOK & Anki
    aiProviderTitle: 'AI Provider (BYOK)',
    baseUrlLabel: 'OpenAI-Compatible Base URL',
    apiKeyLabel: 'API Key',
    modelLabel: 'Model',
    loadedSuffix: 'loaded',
    pickFromList: 'Pick from list',
    enterManually: 'Enter manually',
    notInList: 'not in list',
    refreshModels: 'Refresh models list (GET /models)',
    chooseBtn: 'Select',
    fallbackModelLabel: 'Fallback Model (on 503 / 429)',
    doNotUse: 'Do not use',
    currentTag: 'current',
    fallbackPlaceholder: 'Optional (e.g. gemini-3.8-flash-lite / gpt-4o)',
    fallbackHint:
      'If the primary model is overloaded (503/429), requests automatically route to this model.',
    resolvedEndpoint: 'Resolved endpoint:',
    testLlmBtn: 'Test LLM Connection',
    llmPermissionDenied: (origin: string) => `Host permission for ${origin} was denied.`,
    ankiAndCache: 'AnkiConnect & Cache',
    ankiUrlLabel: 'AnkiConnect URL',
    ankiDeckLabel: 'Deck Name',
    testAnkiBtn: 'Test AnkiConnect',
    ankiConnected: (version: number) => `Connected · AnkiConnect v${version}`,
    cacheCleared: 'Cache Cleared ✓',
    clearCacheBtn: 'Clear IDB Cache',

    // PlayerControls
    disableExt: 'Disable Lang AI',
    enableExt: 'Enable Lang AI',
    retryNow: 'Retry',
    captionRateLimitedTooltip: 'HTTP 429: Caption request rate limit. Cache active, retries paused.',
    translationCooldownTooltip: (sec: number) =>
      `Temporary translator rate limit · auto-retry in ${sec}s (click to retry now)`,
    translationUnavailableTooltip: 'Translation temporarily unavailable · click to retry',
    trackDual: 'Dual Subtitles',
    trackDualDesc: 'Original text with translation on the second line',
    trackDualTooltip: 'Dual subtitles (Original + Translation) · Click: translation only',
    trackTransOnly: 'Translation Only',
    trackTransOnlyDesc: 'Translated line only (hold Alt to reveal original for word lookup)',
    trackTransOnlyTooltip: 'Translation only (Alt reveals original) · Click: original only',
    trackOrigOnly: 'Original Only',
    trackOrigOnlyDesc: 'Original subtitle track without translation',
    trackOrigOnlyTooltip: 'Original only · Click: dual subtitles',
    translationDirectionTooltip: (src: string, tgt: string) =>
      `Translation direction: [${src}] ⇄ [${tgt}]`,
    sourceLangSelectTooltip: (label: string) => `Source language: ${label} (click to choose)`,
    reverseTranslationTooltip: (src: string, tgt: string) =>
      `Reverse translation direction ([${src}] ⇄ [${tgt}])`,
    targetLangSelectTooltip: (label: string, smart: boolean) =>
      `Target language: ${label}${smart ? ' (smart auto-switch)' : ''} (click to choose)`,
    sourceLangHeader: 'Source Language',
    targetLangHeader: 'Target Language',
    listenNormal: 'Normal Mode',
    listenNormalDesc: 'Subtitles are always visible on screen.',
    listenNormalTooltip: 'Normal mode: Subtitles visible (click to enable Active Listening)',
    listenBlur: 'Active Listening (Blur)',
    listenBlurDesc: 'Text is blurred for ear training; reveals on hover or holding Alt.',
    listenBlurTooltip: 'Active Listening: Blur (click to switch to Stealth)',
    listenStealth: 'Stealth Mode (Alt Only)',
    listenStealthDesc: 'Subtitles stay hidden and appear only while holding Alt.',
    listenStealthTooltip: 'Stealth mode: Hidden until Alt (click to turn off)',
    autoPauseTimerOnTooltip: (sec: number) =>
      `Auto-pause enabled with ${sec}s resume timer (click to disable, hover for timer)`,
    autoPauseOnTooltip: 'Auto-pause enabled (click to disable, hover for timer)',
    autoPauseOffTooltip: 'Auto-pause at end of subtitle (click to enable, hover for timer)',
    timerOffTitle: 'Auto-pause off',
    timerOffDesc: 'Continuous playback without pausing at subtitle end.',
    timerManualTitle: 'Manual auto-pause (no timer)',
    timerManualDesc: 'Pauses at the end of every subtitle until you resume manually.',
    timerSecTitle: (s: number) => `Auto-pause with ${s}s timer`,
    timerSecDesc: (s: number) => `Pauses at subtitle end and resumes automatically after ${s}s.`,
    timerCustomTitle: 'Custom timer delay',
    timerCustomDesc: 'Enter delay from 0.5 to 300s (e.g. 1.5, 2.5) and press Enter or ✓.',
    pauseManualLabel: 'Manual',
    repeatCueTooltip: 'Repeat current subtitle',
    fontStyleTooltip: (px: number) => `Subtitle font size: ${px}px (hover to adjust)`,
    resetSizePosTooltip: 'Reset subtitle size and position to default',
    systemMenuTooltip: 'System info, logs & settings (hover for status, click to open Settings)',
    compactBadgeTitle: 'Compact mode · font auto-scaled to fit box',
    overflowBadgeTitle: 'Overflow · scroll inside box or drag bigger to restore font',
    detentPullHint: 'Hold to unlock compact size…',
    wordClickPauseTitle: (on: boolean) => `Pause on word click: ${on ? 'On' : 'Off'}`,
    wordClickPauseOnDesc: 'Video pauses when you click a word. Click to disable.',
    wordClickPauseOffDesc: 'Video keeps playing when you click a word. Click to enable.',
    fontSizeTitle: 'Subtitle Size',
    transSizeTitle: 'Translation Size',
    fontFamilyTitle: 'Font',
    fontWeightTitle: 'Weight',
    weightNormal: 'Regular',
    weightBold: 'Bold',
    outlineTitle: 'Outline',
    outlineNone: 'None',
    outlineShadow: 'Shadow',
    outlineStroke: 'Stroke',
    backdropTitle: 'Backdrop',
    staticBoxTitle: 'Static Box',
    resetSizeBtn: 'Reset size',
    resetStyleBtn: 'Reset style',
    autoPauseCountdown: (s: number) => `Auto-pause: ${s}s...`,
    resumeNowTitle: 'Resume playback now',

    // SubtitleOverlay
    dragTooltip: 'Drag to move · Double-click to reset to center',
    lockOnTooltip: 'Static box enabled (click to switch to adaptive size)',
    lockOffTooltip: 'Adaptive size (click to lock box size)',
    altOriginalHint: 'Original (Alt) · Click a word to save',
    blurHint: 'Active Listening · Hover or hold Alt to reveal',
    stealthHint: 'Stealth Mode · Alt held',
    retryingTranslation: 'Retrying translation…',

    // WordPopup
    pronounce: 'Pronounce',
    closeEsc: 'Close (Esc)',
    translating: 'Translating...',
    translationError: 'Translation error',
    extensionUpdatedReload: 'Extension was updated — please reload the page (F5)',
    emptyWorkerResponse: 'Empty response from background service worker',
    subtitleContext: 'Subtitle Context',
    pronounceSentence: 'Pronounce full sentence',
    loadingContextTrans: 'Loading context translation...',
    aiBreakdownBtn: 'AI Context Breakdown',
    connectAiBtn: 'Connect AI (Gemini / Ollama)',
    analyzingContext: 'Analyzing scene context with AI...',
    aiExplanationFailed: 'AI explanation failed',
    aiMissingKeyTitle: 'API key is not configured.',
    aiMissingKeyDesc: 'Connect an AI provider in extension settings.',
    aiOverloadedTitle: 'Model server temporarily overloaded (503).',
    aiOverloadedDesc: 'Please try again in a few seconds.',
    aiRateLimitTitle: 'Rate limit exceeded (429).',
    aiRateLimitDesc: 'Please wait a moment and try again.',
    configureAi: 'Configure AI',
    retryBtn: 'Retry',
    aiBreakdownHeader: 'AI Breakdown',
    literalLabel: 'Literal:',
    grammarLabel: 'Grammar:',
    nuanceLabel: 'Nuance:',
    examplesLabel: 'Examples',
    popupShortcuts: 'S save · R repeat · Esc',
    savedBtn: 'Saved',
    saveWordBtn: 'Save word'
  },
  uk: {
    // Popup navigation & header
    appTitle: 'YouTube Lang AI',
    wordsDue: (words: number, due: number) => `${words} слів · ${due} на повторення`,
    fullscreen: 'На весь екран',
    openFullscreenTrainer: 'Відкрити тренажер на весь екран',
    tabTrainer: 'Тренажер',
    tabVocabulary: 'Словник',
    tabSettings: 'Налаштування',
    loadingWorkspace: 'Завантаження...',

    // Trainer & Vocabulary
    allSources: 'Усі джерела',
    emptyVocabTitle: 'Ваш словник порожній',
    emptyVocabDescPrefix:
      'Відкрийте будь-яке відео із субтитрами, натисніть на незнайоме слово та тисніть',
    emptyVocabSaveBtn: 'У словник',
    emptyVocabOrPress: 'або натисніть',
    allCaughtUp: 'Усе повторено!',
    completedReviews: (count: number) => `Повторено карток за сесію: ${count}. `,
    savedCardsCount: (count: number) => `У цій колоді збережено карток: ${count}.`,
    practiceAllAnyway: 'Повторити всі картки',
    freePractice: 'Вільна практика',
    dueQueue: 'Черга повторення',
    exitFreePractice: 'Вийти з вільної практики',
    noContextSentence: 'Контекстне речення не збережено.',
    showAnswerSpace: 'Показати відповідь (Space)',
    lemmaLabel: 'Лема:',
    ratingAgain: 'Знову',
    ratingHard: 'Важко',
    ratingGood: 'Добре',
    ratingEasy: 'Легко',
    searchPlaceholder: 'Пошук слова, перекладу, речення, відео...',
    filterAll: 'Усі',
    filterDue: 'До повтору',
    filterNew: 'Нові',
    filterLearning: 'Вивчаються',
    filterReview: 'Повторення',
    noCardsMatch: 'Немає карток за вашим фільтром.',
    copied: 'Скопійовано',
    tgCopy: 'TG Копія',
    csvBtn: 'CSV (UTF-8)',
    ankiConnectBtn: 'AnkiConnect',
    telegramBtn: 'Telegram',
    openSourcePage: 'Відкрити сторінку відео',
    deleteCard: 'Видалити картку',
    ankiPermissionDenied: 'Дозвіл для локального хоста AnkiConnect відхилено.',
    ankiExportPartial: (added: number, skipped: number, firstError: string) =>
      `Додано ${added}, пропущено ${skipped}, помилки: ${firstError}`,
    ankiExportSuccess: (added: number, skipped: number) =>
      `Експорт до Anki завершено: додано ${added}, пропущено дублікатів ${skipped}.`,
    ankiExportFailed: 'Помилка експорту AnkiConnect',

    // Settings — Platform Modules
    platformModules: 'Модулі платформ',
    modularSystem: 'Модульна система',
    builtInBadge: 'Вбудовано',
    activeBadge: 'Активний',
    disabledBadge: 'Вимкнено',
    builtInServiceDesc: 'Вбудований базовий модуль платформи',
    dynamicServiceDesc: (hosts: string) =>
      hosts ? `Додатковий модуль (${hosts})` : 'Додатковий динамічний модуль',
    servicePermissionDenied: (name: string) => `Потрібен дозвіл доступу до сайту для ${name}`,
    serviceToggleFailed: (name: string) => `Не вдалося перемкнути модуль ${name}`,
    siteAllowed: 'Дозвіл для сайту надано',
    siteNeedsPerm: 'Потрібен дозвіл для поточного сайту',
    restartScript: 'Перезапустити скрипт',
    enableOnSite: 'Увімкнути на цьому сайті',
    sitePermissionDenied: (host: string) => `Доступ до ${host} відхилено`,

    // Settings — App Language
    appLanguageTitle: 'Мова застосунку',
    appLanguageDesc: 'Мова інтерфейсу (системні логи завжди англійською)',

    // Settings — Mini-Tabs & Group Headings
    subTabGeneral: 'Загальні',
    subTabStyle: 'Стиль',
    subTabPlayer: 'Плеєр',
    subTabKeys: 'Клавіші',
    subTabIntegrations: 'AI · Anki',
    livePreviewLabel: 'Живий перегляд',
    trackSizesTitle: 'Розмір доріжок (px)',
    typographyTitle: 'Типографіка та підкладка',
    behaviorTogglesTitle: 'Поведінка плеєра',
    primaryShort: 'Ориг',
    transShort: 'Пер.',
    primaryTrackTitle: 'Оригінал',
    transTrackTitle: 'Переклад',
    primaryTrackHint: 'Розмір основної доріжки (12–56px). Клік по числу — скинути на 20px.',
    transTrackHint: 'Розмір перекладу (12–48px). Клік по числу — скинути на 17px.',
    resetTo20px: 'Скинути на 20px',
    resetTo17px: 'Скинути на 17px',

    // Settings — Appearance & Subtitles
    appearanceSubtitles: 'Оформлення та субтитри',
    colorTheme: 'Кольорова тема',
    popupScaleTitle: 'Масштаб віджета',
    popupScaleHint: 'Масштабує вікно й текст незалежно від шрифту браузера',
    subtitleFontSize: 'Розмір шрифту субтитрів',
    standardLabel: 'Стандарт',
    overlayOpacity: 'Прозорість підкладки субтитрів',
    transparentLabel: 'Прозорий',
    solidLabel: 'Щільний',
    activeListeningTitle: 'Режим тренування слуху (Active Listening)',
    modeNormal: 'Звичайний',
    modeNormalDesc: 'Завжди видимі',
    modeBlur: 'Розмиття',
    modeBlurDesc: 'Наведення або Alt',
    modeStealth: 'Скритий',
    modeStealthDesc: 'Лише клавіша Alt',
    controlsScaleTitle: 'Розмір верхньої панелі',
    controlsCompact: 'Компактний (S · 85%)',
    controlsStandard: 'Стандартний (M · 100%)',
    controlsLarge: 'Великий (L · 125%)',
    controlsMax: 'Максимальний (XL · 150%)',
    subtitlePosition: 'Позиція субтитрів',
    posCustom: (x: number, y: number) => `Зміщено (${x}%, ${y}%)`,
    posDefault: 'По центру знизу (за замовчуванням)',
    resetBtn: 'Скинути',
    dragHint: 'Перетягуйте мишею',

    // Settings — Languages & Behavior
    langAndBehavior: 'Мови та керування плеєром',
    translationDirection: 'Напрямок перекладу',
    reverseTag: 'Реверс',
    smartSwitchTag: 'Розумний',
    reverseBtn: 'Реверс',
    reverseBtnTitle: 'Поміняти напрямок перекладу місцями',
    targetLangLabel: 'Цільова мова (Рідна)',
    sourceLangLabel: 'Мова оригіналу відео',
    secondaryLangLabel: 'Додаткова мова (для авто-реверсу)',
    secondaryLangHint:
      'Якщо мова субтитрів збігається з цільовою, переклад автоматично перемикається на додаткову мову.',
    toggleOverlay: 'Увімкнути субтитри та панель плеєра (Overlay)',
    toggleDual: 'Показувати подвійні (перекладені) субтитри',
    toggleAutoHide: 'Автоприховування панелі при бездіяльності',
    toggleAltHold: 'Автопауза при утриманні Alt (продовження при відпусканні)',
    toggleAutoPauseCue: 'Автопауза в кінці кожної репліки субтитрів',
    togglePauseOnWord: 'Пауза при кліку на слово (для перекладу)',
    pauseTimerTitle: 'Таймер зняття автопаузи',
    offLabel: 'Вимк',
    secShort: 'с',
    secWord: 'сек',

    // Settings — Hotkeys
    hotkeysTitle: 'Гарячі клавіші',
    hotkeysResetTitle: 'Скинути всі гарячі клавіші за замовчуванням',
    keyConflict: 'Конфлікт клавіш',
    pressKey: 'Натисніть клавішу...',
    clearHotkey: 'Очистити клавішу',

    // Settings — Translation Provider
    subtitleTranslationTitle: 'Переклад субтитрів',
    subtitleTranslationDesc: 'Спільний провайдер для всіх відеоплатформ',
    myMemoryEmailLabel: 'Контактний email — необовʼязково',
    myMemoryEmailPlaceholder: 'Email для ліміту 50 000 символів/день',
    deeplKeyPlaceholder: 'Введіть ключ DeepL API Free',
    hideKey: 'Сховати ключ',
    showKey: 'Показати ключ',

    // Settings — LLM BYOK & Anki
    aiProviderTitle: 'AI Провайдер (BYOK)',
    baseUrlLabel: 'OpenAI-сумісний Base URL',
    apiKeyLabel: 'API-ключ',
    modelLabel: 'Модель',
    loadedSuffix: 'завантажено',
    pickFromList: 'Обрати зі списку',
    enterManually: 'Ввести вручну',
    notInList: 'немає у списку',
    refreshModels: 'Оновити список моделей (GET /models)',
    chooseBtn: 'Обрати',
    fallbackModelLabel: 'Резервна модель (при 503 / 429)',
    doNotUse: 'Не використовувати',
    currentTag: 'поточна',
    fallbackPlaceholder: 'Опціонально (напр. gemini-3.8-flash-lite / gpt-4o)',
    fallbackHint:
      'Якщо основна модель перевантажена (503/429), запит автоматично піде на цю модель.',
    resolvedEndpoint: 'Кінцевий URL:',
    testLlmBtn: 'Перевірити підключення LLM',
    llmPermissionDenied: (origin: string) => `Дозвіл доступу до хоста ${origin} відхилено.`,
    ankiAndCache: 'AnkiConnect та кеш',
    ankiUrlLabel: 'AnkiConnect URL',
    ankiDeckLabel: 'Назва колоди',
    testAnkiBtn: 'Перевірити AnkiConnect',
    ankiConnected: (version: number) => `Підключено · AnkiConnect v${version}`,
    cacheCleared: 'Кеш очищено ✓',
    clearCacheBtn: 'Очистити IDB кеш',

    // PlayerControls
    disableExt: 'Вимкнути Lang AI',
    enableExt: 'Увімкнути Lang AI',
    retryNow: 'Повтор',
    captionRateLimitedTooltip:
      'HTTP 429: Ліміт запитів субтитрів. Кеш активний, повторні запити призупинено.',
    translationCooldownTooltip: (sec: number) =>
      `Тимчасовий ліміт перекладача · автоповтор через ${sec}с (клік — повторити зараз)`,
    translationUnavailableTooltip: 'Переклад тимчасово недоступний · клік — повторити',
    trackDual: 'Подвійні субтитри',
    trackDualDesc: 'Оригінальний текст і переклад другим рядком',
    trackDualTooltip: 'Подвійні субтитри (Оригінал + Переклад) · Клік: лише переклад',
    trackTransOnly: 'Лише переклад',
    trackTransOnlyDesc: 'Тільки перекладений рядок (оригінал по Alt для розбору слів)',
    trackTransOnlyTooltip: 'Лише переклад (оригінал по Alt) · Клік: лише оригінал',
    trackOrigOnly: 'Лише оригінал',
    trackOrigOnlyDesc: 'Тільки оригінальна доріжка без перекладу',
    trackOrigOnlyTooltip: 'Лише оригінал · Клік: подвійні субтитри',
    translationDirectionTooltip: (src: string, tgt: string) =>
      `Напрямок перекладу: [${src}] ⇄ [${tgt}]`,
    sourceLangSelectTooltip: (label: string) => `Мова оригіналу: ${label} (натисніть для вибору)`,
    reverseTranslationTooltip: (src: string, tgt: string) =>
      `Зворотний переклад ([${src}] ⇄ [${tgt}])`,
    targetLangSelectTooltip: (label: string, smart: boolean) =>
      `Цільова мова перекладу: ${label}${smart ? ' (розумне автоперемикання)' : ''} (натисніть для вибору)`,
    sourceLangHeader: 'Мова оригіналу (Source)',
    targetLangHeader: 'Мова перекладу (Target)',
    listenNormal: 'Звичайний режим',
    listenNormalDesc: 'Субтитри завжди відображаються на екрані.',
    listenNormalTooltip: 'Звичайний режим: Субтитри видимі (клік — увімкнути Active Listening)',
    listenBlur: 'Active Listening (Розмиття)',
    listenBlurDesc: 'Текст розмито для тренування слуху; проявляється при наведенні або Alt.',
    listenBlurTooltip: 'Active Listening: Розмиття (клік — перемкнути на Stealth)',
    listenStealth: 'Stealth-режим (Лише по Alt)',
    listenStealthDesc: 'Субтитри приховані й зʼявляються лише при утриманні клавіші Alt.',
    listenStealthTooltip: 'Stealth-режим: Сховано до Alt (клік — вимкнути)',
    autoPauseTimerOnTooltip: (sec: number) =>
      `Автопауза увімкнена з таймером ${sec}с (клік — вимкнути, наведіть для таймера)`,
    autoPauseOnTooltip: 'Автопауза субтитрів увімкнена (клік — вимкнути, наведіть для таймера)',
    autoPauseOffTooltip: 'Автопауза в кінці субтитрів (клік — увімкнути, наведіть для таймера)',
    timerOffTitle: 'Автопауза вимкнена',
    timerOffDesc: 'Безперервне відтворення без зупинок у кінці субтитрів.',
    timerManualTitle: 'Примусова автопауза (без таймера)',
    timerManualDesc: 'Ставить на паузу в кінці кожної репліки до ручного продовження.',
    timerSecTitle: (s: number) => `Автопауза з таймером ${s}с`,
    timerSecDesc: (s: number) => `Зупиняє в кінці репліки та продовжує через ${s}с.`,
    timerCustomTitle: 'Власний час таймера',
    timerCustomDesc: 'Введіть затримку від 0.5 до 300с (напр. 1.5, 2.5) і натисніть Enter або ✓.',
    pauseManualLabel: 'Ручна',
    repeatCueTooltip: 'Повторити поточну фразу',
    fontStyleTooltip: (px: number) => `Розмір шрифту субтитрів: ${px}px (наведіть для налаштування)`,
    resetSizePosTooltip: 'Скинути розмір і позицію субтитрів за замовчуванням',
    systemMenuTooltip:
      'Системна інформація, логи та налаштування (наведіть для статусу, клік — Налаштування)',
    compactBadgeTitle: 'Компактний режим · шрифт масштабовано під вікно',
    overflowBadgeTitle: 'Переповнення · прокрутіть текст або розширте вікно',
    detentPullHint: 'Утримуйте, щоб розблокувати компактний розмір…',
    wordClickPauseTitle: (on: boolean) => `Пауза при кліку по слову: ${on ? 'Увімк' : 'Вимк'}`,
    wordClickPauseOnDesc: 'Відео ставиться на паузу при кліку на слово. Натисніть, щоб вимкнути.',
    wordClickPauseOffDesc: 'Відео продовжує грати при кліку на слово. Натисніть, щоб увімкнути.',
    fontSizeTitle: 'Розмір субтитрів',
    transSizeTitle: 'Розмір перекладу',
    fontFamilyTitle: 'Шрифт',
    fontWeightTitle: 'Накреслення',
    weightNormal: 'Звичайний',
    weightBold: 'Жирний',
    outlineTitle: 'Обведення',
    outlineNone: 'Немає',
    outlineShadow: 'Тінь',
    outlineStroke: 'Контур',
    backdropTitle: 'Підкладка',
    staticBoxTitle: 'Статичне вікно',
    resetSizeBtn: 'Скинути розмір',
    resetStyleBtn: 'Скинути стиль',
    autoPauseCountdown: (s: number) => `Автопауза: ${s}с...`,
    resumeNowTitle: 'Продовжити відтворення зараз',

    // SubtitleOverlay
    dragTooltip: 'Перетягніть для зміщення · Подвійний клік для скидання по центру',
    lockOnTooltip: 'Статичне вікно увімкнено (клік — адаптивний розмір)',
    lockOffTooltip: 'Адаптивний розмір (клік — зафіксувати розмір вікна)',
    altOriginalHint: 'Оригінал (Alt) · Клікніть слово для збереження',
    blurHint: 'Active Listening · Наведіть або затисніть Alt',
    stealthHint: 'Stealth-режим · Alt затиснуто',
    retryingTranslation: 'Повтор перекладу…',

    // WordPopup
    pronounce: 'Озвучити',
    closeEsc: 'Закрити (Esc)',
    translating: 'Переклад...',
    translationError: 'Помилка перекладу',
    extensionUpdatedReload: 'Розширення було оновлено — перезавантажте сторінку (F5)',
    emptyWorkerResponse: 'Порожня відповідь від фонового сервісу',
    subtitleContext: 'Контекст субтитра',
    pronounceSentence: 'Озвучити речення повністю',
    loadingContextTrans: 'Завантаження перекладу контексту...',
    aiBreakdownBtn: 'AI Контекстний розбір',
    connectAiBtn: 'Підключити AI (Gemini / Ollama)',
    analyzingContext: 'AI аналізує контекст сцени...',
    aiExplanationFailed: 'Не вдалося отримати розбір AI',
    aiMissingKeyTitle: 'Не налаштований API-ключ.',
    aiMissingKeyDesc: 'Підключіть AI у налаштуваннях розширення.',
    aiOverloadedTitle: 'Сервер моделі тимчасово перевантажений (503).',
    aiOverloadedDesc: 'Спробуйте ще раз через кілька секунд.',
    aiRateLimitTitle: 'Перевищено ліміт запитів (429).',
    aiRateLimitDesc: 'Зачекайте трохи та повторіть спробу.',
    configureAi: 'Налаштувати AI',
    retryBtn: 'Повторити',
    aiBreakdownHeader: 'AI Розбір',
    literalLabel: 'Дослівно:',
    grammarLabel: 'Граматика:',
    nuanceLabel: 'Нюанс:',
    examplesLabel: 'Приклади',
    popupShortcuts: 'S зберегти · R повтор · Esc',
    savedBtn: 'Збережено',
    saveWordBtn: 'У словник'
  }
};

export function getUiStrings(lang?: UiLanguage): UiTranslationStrings {
  return lang === 'uk' ? UI_TRANSLATIONS.uk : UI_TRANSLATIONS.en;
}
