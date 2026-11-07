// The My records / Global records switch in the Voyage Records title bar.

export type RecordsView = 'mine' | 'global';

const VIEWS: { id: RecordsView; label: string; href: string }[] = [
  { id: 'mine', label: 'My records', href: '#/voyage-records' },
  { id: 'global', label: 'Global records', href: '#/records' },
];

export function recordsSwitch(active: RecordsView): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'vr-switch';
  nav.setAttribute('aria-label', 'Records');
  for (const view of VIEWS) {
    const link = document.createElement('a');
    link.className = `vr-switch-option${view.id === active ? ' is-active' : ''}`;
    link.href = view.href;
    link.textContent = view.label;
    if (view.id === active) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  return nav;
}
