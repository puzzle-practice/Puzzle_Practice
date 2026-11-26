import { Store } from './storage';

export interface KeyBinding {
  id: string;
  label: string;
  defaultKey: string;
}

const store = new Store('global');
let bindings = store.get<Record<string, Record<string, string>>>('keyBindings', {});

export function keyName(value: string): string {
  const key = value.trim().toLowerCase().replace(/\s+/g, '');
  if (key === 'spacebar') return 'space';
  if (key === 'esc') return 'escape';
  if (key === 'ctrl') return 'control';
  if (key === 'left') return 'arrowleft';
  if (key === 'right') return 'arrowright';
  if (key === 'up') return 'arrowup';
  if (key === 'down') return 'arrowdown';
  return key;
}

export function keyLabel(value: string): string {
  const key = keyName(value);
  const named: Record<string, string> = {
    arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
    space: 'Space', escape: 'Escape', enter: 'Enter', pageup: 'PageUp', pagedown: 'PageDown',
    home: 'Home', end: 'End', clear: 'Clear',
    control: 'Ctrl', alt: 'Alt', meta: 'Cmd',
  };
  return named[key] ?? (key.length === 1 ? key.toUpperCase() : value);
}

export function keyFor(puzzle: string, id: string, defaultKey: string): string {
  return keyName(bindings[puzzle]?.[id] || defaultKey);
}

export function keyMatches(key: string, puzzle: string, id: string, defaultKey: string, aliases: readonly string[] = []): boolean {
  const saved = bindings[puzzle]?.[id];
  return saved ? keyName(key) === keyName(saved) : [defaultKey, ...aliases].some((candidate) => keyName(key) === keyName(candidate));
}

export function setKey(puzzle: string, id: string, value: string): boolean {
  const next = { ...bindings, [puzzle]: { ...bindings[puzzle] } };
  if (value.trim()) next[puzzle][id] = keyName(value);
  else delete next[puzzle][id];
  if (!Object.keys(next[puzzle]).length) delete next[puzzle];
  bindings = next;
  return store.set('keyBindings', bindings);
}

export function resetKeys(puzzle: string): void {
  const next = { ...bindings };
  delete next[puzzle];
  bindings = next;
  store.set('keyBindings', bindings);
}
