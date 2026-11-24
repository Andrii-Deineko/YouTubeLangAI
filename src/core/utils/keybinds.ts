import type { KeybindAction, KeybindingsMap, KeybindValue } from '../types/settings';

export const KEYBIND_ACTION_LABELS: Record<KeybindAction, { title: string; description: string }> = {
  holdPeekAndPause: {
    title: 'Проявить оригинал + пауза',
    description: 'Удержание клавиши: показывает скрытый оригинал и ставит плеер на паузу'
  },
  repeatCue: {
    title: 'Повторить фразу',
    description: 'Перемотка на начало текущей реплики субтитров'
  },
  prevCue: {
    title: 'Предыдущая фраза',
    description: 'Перемотка на предыдущую реплику субтитров'
  },
  nextCue: {
    title: 'Следующая фраза',
    description: 'Перемотка на следующую реплику субтитров'
  },
  cycleSubtitleMode: {
    title: 'Режим субтитров',
    description: 'Переключение режимов: Обычный → Блюр → Скрыт'
  },
  cycleTrackMode: {
    title: 'Режим дорожки',
    description: 'Переключение дорожек: Двойные → Только перевод → Только оригинал'
  },
  toggleAutoPause: {
    title: 'Автопауза после фразы',
    description: 'Включение/выключение автопаузы в конце каждой реплики'
  }
};

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

export function formatKeybind(bind: KeybindValue | null): string {
  if (!bind || !bind.code) return 'Не назначено';

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
  for (const [act, otherBind] of Object.entries(map) as Array<[KeybindAction, KeybindValue | null]>) {
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
