import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, type Panel } from './panel';

/** The session lock synchronizes the old values while abandoning a running game. */
function setup() {
  const elements: TestElement[] = [], syncers: Array<() => void> = [];
  class TestElement extends EventTarget {
    value = ''; checked = false; className = ''; type = ''; children: TestElement[] = [];
    append(...children: TestElement[]) { this.children.push(...children); }
    replaceChildren(...children: TestElement[]) { this.children = children; }
    querySelector() { return null; }
    setAttribute() {}
  }
  vi.stubGlobal('document', { activeElement: null, createElement: () => {
    const element = new TestElement(); elements.push(element); return element;
  } });
  const panel = {
    watch() {}, used() {}, sync() { syncers.forEach(sync => sync()); },
    addSync(sync: () => void) { syncers.push(sync); sync(); },
    beforeChange: vi.fn(() => syncers.forEach(sync => sync())),
  };
  const group = new Group(panel as unknown as Panel, new TestElement() as unknown as HTMLElement);
  return { group, panel, elements };
}

afterEach(() => vi.unstubAllGlobals());

describe('settings edited during a session', () => {
  it('applies the newly selected dropdown value after stopping synchronizes the old selection', () => {
    const { group, panel, elements } = setup(); let selected = 0;
    group.select('Bludgeon', [{ value: 0, label: 'Fists' }, { value: 1, label: 'Hammer' }], () => selected, v => { selected = v; });
    const select = elements.find(e => e.className === 'panel-select')!;
    select.value = '1'; select.dispatchEvent(new Event('change'));
    expect(panel.beforeChange).toHaveBeenCalledOnce();
    expect(selected).toBe(1);
  });

  it('retains the clicked toggle value through the session lock', () => {
    const { group, elements } = setup(); let on = false;
    group.toggle('Furball', () => on, v => { on = v; });
    const input = elements.find(e => e.type === 'checkbox')!;
    input.checked = true; input.dispatchEvent(new Event('change'));
    expect(on).toBe(true);
  });

  it('can change a display toggle without abandoning the running session', () => {
    const { group, panel, elements } = setup(); let on = false;
    group.toggle('Show live bruise chance', () => on, v => { on = v; }, { keepsSession: true });
    const input = elements.find(e => e.type === 'checkbox')!;
    input.checked = true; input.dispatchEvent(new Event('change'));
    expect(on).toBe(true);
    expect(panel.beforeChange).not.toHaveBeenCalled();
  });

  it.each(['number', 'range', 'text'] as const)('retains the new %s value through the session lock', kind => {
    const { group, elements } = setup(); let value: number | string = kind === 'text' ? 'old' : 0;
    if (kind === 'text') group.text('Value', () => String(value), v => { value = v; });
    else group[kind]('Value', () => Number(value), v => { value = v; });
    const input = elements.find(e => e.type === (kind === 'range' ? 'range' : kind === 'number' ? 'number' : 'text'))!;
    input.value = kind === 'text' ? 'new' : '7'; input.dispatchEvent(new Event(kind === 'range' ? 'input' : 'change'));
    expect(value).toBe(kind === 'text' ? 'new' : 7);
  });
});
