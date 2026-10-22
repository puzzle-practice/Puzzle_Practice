import { copyText, pasteText } from './clipboard';
import type { Panel } from './panel';
import type { Store } from './storage';

/** Stable substreams: consuming one stream never advances another. */
export function seedFor(seed: number | bigint | string, stream: string, index = 0): number {
  let h = 0x811c9dc5;
  for (const c of `${seed}:${stream}:${index}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35); return (h ^ h >>> 16) >>> 0;
}

export const freshSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];
export const readSeed = (text: string): number | null => /^\d{1,10}$/.test(text.trim()) && Number(text) <= 0xffffffff ? Number(text) : null;

/** The selected seed belongs to a session, rather than to the browser's random history. */
export function seedControls(panel: Panel, store: Store, busy: () => boolean) {
  let enabled = store.get<boolean>('seedMode', false) === true;
  let selected = readSeed(String(store.get('sessionSeed', freshSeed()))) ?? freshSeed();
  let last: number | null = null;
  const save = () => { store.set('seedMode', enabled); store.set('sessionSeed', selected); };
  const set = (text: string) => { const value = readSeed(text); if (value !== null && !busy()) { selected = value; enabled = true; save(); } };
  const shown = () => busy() ? last ?? selected : enabled ? selected : last ?? selected;
  const group = panel.seedSettings.group('Seed');
  group.toggle('Fixed seed', () => enabled, value => { if (value) selected = last ?? selected; enabled = value; save(); }, { disabled: busy,
    title: 'On: repeat this seed without setting PBs. Off: a fresh seed for every run.' });
  group.text('Seed', () => String(shown()), set, { inputMode: 'numeric', disabled: busy });
  group.button('Copy', () => copyText(String(shown()), 'Copy this seed:'));
  group.button('Paste', () => { void pasteText('Paste a seed:').then(text => { if (text !== null && !busy()) set(text); }); }, { disabled: busy });
  group.button('New', () => { selected = freshSeed(); enabled = true; save(); }, { disabled: busy });
  return { next: () => { store.setScoresEnabled(!enabled); return last = enabled ? selected : freshSeed(); },
    remember: (seed: number) => { last = seed; }, get enabled() { return enabled; } };
}
