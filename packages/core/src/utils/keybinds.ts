import type { KeybindAction, KeybindingsMap, KeybindValue, UiLanguage } from '@langai/contracts';

type KeybindLabelsMap = Record<KeybindAction, { title: string; description: string }>;

const KEYBIND_ACTION_LABELS_BY_LANG: Record<UiLanguage, KeybindLabelsMap> = {
  en: {
    holdPeekAndPause: {
      title: 'Reveal original + pause',
      description: 'Hold key to reveal hidden original subtitles and pause playback'
    },
    repeatCue: {
      title: 'Repeat subtitle',
      description: 'Jump back to the start of the current subtitle cue'
    },
    prevCue: {
      title: 'Previous subtitle',
      description: 'Seek to the previous subtitle cue'
    },
    nextCue: {
      title: 'Next subtitle',
      description: 'Seek to the next subtitle cue'
    },
    cycleSubtitleMode: {
      title: 'Listening mode',
      description: 'Cycle display mode: Normal → Blur → Stealth'
    },
    cycleTrackMode: {
      title: 'Track mode',
      description: 'Cycle tracks: Dual → Translation Only → Original Only'
    },
    toggleAutoPause: {
      title: 'Auto-pause after cue',
      description: 'Toggle automatic pause at the end of every subtitle cue'
    },
    quickSaveCard: {
      title: 'Quick-save card',
      description: 'Save the active word or phrase to your vocabulary deck'
    }
  },
  uk: {
    holdPeekAndPause: {
      title: 'Показати оригінал + пауза',
      description: 'Утримання клавіші: показує прихований оригінал і ставить плеєр на паузу'
    },
    repeatCue: {
      title: 'Повторити фразу',
      description: 'Перемотування на початок поточної репліки субтитрів'
    },
    prevCue: {
      title: 'Попередня фраза',
      description: 'Перемотування на попередню репліку субтитрів'
    },
    nextCue: {
      title: 'Наступна фраза',
      description: 'Перемотування на наступну репліку субтитрів'
    },
    cycleSubtitleMode: {
      title: 'Режим субтитрів',
      description: 'Перемикання режимів: Звичайний → Розмиття → Скритий'
    },
    cycleTrackMode: {
      title: 'Режим доріжки',
      description: 'Перемикання доріжок: Подвійні → Лише переклад → Лише оригінал'
    },
    toggleAutoPause: {
      title: 'Автопауза після фрази',
      description: 'Увімкнення/вимкнення автопаузи в кінці кожної репліки'
    },
    quickSaveCard: {
      title: 'Швидке збереження картки',
      description: 'Зберегти активне слово або фразу до словника'
    }
  }
};

export const KEYBIND_ACTION_LABELS: KeybindLabelsMap = KEYBIND_ACTION_LABELS_BY_LANG.en;

export function getKeybindActionLabels(lang?: UiLanguage): KeybindLabelsMap {
  return lang === 'uk' ? KEYBIND_ACTION_LABELS_BY_LANG.uk : KEYBIND_ACTION_LABELS_BY_LANG.en;
}

const KEY_CODE_NAMES: Record<string, string> = {
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  MetaLeft: 'Left Win / Cmd',
  MetaRight: 'Right Win / Cmd',
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Esc',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.'
};

export function formatKeybind(bind: KeybindValue | null, lang?: UiLanguage): string {
  if (!bind || !bind.code) return lang === 'uk' ? 'Не призначено' : 'Not set';

  let keyName = KEY_CODE_NAMES[bind.code];
  if (!keyName) {
    if (bind.code.startsWith('Key')) {
      keyName = bind.code.slice(3);
    } else if (bind.code.startsWith('Digit')) {
      keyName = bind.code.slice(5);
    } else if (bind.code.startsWith('Numpad')) {
      keyName = `Num ${bind.code.slice(6)}`;
    } else {
      keyName = bind.code;
    }
  }

  const isModifierCode =
    bind.code === 'AltLeft' ||
    bind.code === 'AltRight' ||
    bind.code === 'ShiftLeft' ||
    bind.code === 'ShiftRight' ||
    bind.code === 'ControlLeft' ||
    bind.code === 'ControlRight' ||
    bind.code === 'MetaLeft' ||
    bind.code === 'MetaRight';

  if (isModifierCode) {
    return keyName;
  }

  const parts: string[] = [];
  if (bind.ctrl) parts.push('Ctrl');
  if (bind.alt) parts.push('Alt');
  if (bind.shift) parts.push('Shift');
  parts.push(keyName);

  return parts.join(' + ');
}

export function isSameKeybind(a: KeybindValue | null, b: KeybindValue | null): boolean {
  if (!a || !b) return false;
  return (
    a.code === b.code &&
    Boolean(a.ctrl) === Boolean(b.ctrl) &&
    Boolean(a.alt) === Boolean(b.alt) &&
    Boolean(a.shift) === Boolean(b.shift)
  );
}

export function findKeybindConflict(
  action: KeybindAction,
  bind: KeybindValue | null,
  map: KeybindingsMap
): KeybindAction | null {
  if (!bind || !bind.code) return null;
  for (const [act, otherBind] of Object.entries(map) as Array<
    [KeybindAction, KeybindValue | null]
  >) {
    if (act !== action && isSameKeybind(bind, otherBind)) {
      return act;
    }
  }
  return null;
}

export function matchesTapKeybind(e: KeyboardEvent, bind: KeybindValue | null): boolean {
  if (!bind || !bind.code) return false;
  if (e.code !== bind.code) return false;

  const bindCtrl = Boolean(bind.ctrl);
  const bindAlt = Boolean(bind.alt);
  const bindShift = Boolean(bind.shift);

  const isCtrlKey = bind.code === 'ControlLeft' || bind.code === 'ControlRight';
  const isAltKey = bind.code === 'AltLeft' || bind.code === 'AltRight';
  const isShiftKey = bind.code === 'ShiftLeft' || bind.code === 'ShiftRight';

  if (!isCtrlKey && Boolean(e.ctrlKey) !== bindCtrl) return false;
  if (!isAltKey && Boolean(e.altKey) !== bindAlt) return false;
  if (!isShiftKey && Boolean(e.shiftKey) !== bindShift) return false;

  return true;
}

export function matchesHoldKeybind(e: KeyboardEvent, bind: KeybindValue | null): boolean {
  if (!bind || !bind.code) return false;

  if (bind.code === 'AltLeft' || bind.code === 'AltRight') {
    return e.code === bind.code || e.key === 'Alt';
  }
  if (bind.code === 'ShiftLeft' || bind.code === 'ShiftRight') {
    return e.code === bind.code || e.key === 'Shift';
  }
  if (bind.code === 'ControlLeft' || bind.code === 'ControlRight') {
    return e.code === bind.code || e.key === 'Control';
  }

  return matchesTapKeybind(e, bind);
}

export function isHoldKeybindRelease(e: KeyboardEvent, bind: KeybindValue | null): boolean {
  if (!bind || !bind.code) return false;

  if (bind.code === 'AltLeft' || bind.code === 'AltRight') {
    return e.code === bind.code || e.key === 'Alt';
  }
  if (bind.code === 'ShiftLeft' || bind.code === 'ShiftRight') {
    return e.code === bind.code || e.key === 'Shift';
  }
  if (bind.code === 'ControlLeft' || bind.code === 'ControlRight') {
    return e.code === bind.code || e.key === 'Control';
  }

  return e.code === bind.code;
}
