import { describe, expect, it } from 'vitest';
import { recolour, toHsv, toRgb, ZATIONS } from '../../core/duty/paint';
import { glovePalette } from './portrait';

describe('portrait gloves', () => {
  it('uses separate primary and secondary dye indices, including unsigned colour bytes', () => {
    expect(glovePalette({ type: 2, colours: 0x52 }, 'tan')).toEqual({ glove_p: 'blue', glove_s: 'red', skin: 'tan' });
    expect(glovePalette({ type: 2, colours: -1 }, 'dark')).toEqual({ glove_p: 'black', glove_s: 'black', skin: 'dark' });
  });

  it('colours exposed hands with the portrait skin and uses the bone palette for bones', () => {
    expect(glovePalette({ type: 127, colours: 0 }, 'medium').skin).toBe('medium');
    expect(glovePalette({ type: 126, colours: 0 }, 'pale').skin).toBe('pale');
    expect(glovePalette({ type: 13, colours: 12 }, 'tan')).toEqual({ bones_item: 'ice', skin: 'tan' });
  });

  it('recolours the green secondary artwork independently of the red primary artwork', () => {
    const z = ZATIONS.glove_s;
    const source = toHsv(0x22, 0x86, 0x27);
    const changed = toRgb(recolour(source, [{ source, range: z.range, offsets: z.colours.red }])!);
    expect(changed[0]).toBeGreaterThan(changed[1]);
    expect(changed[0]).toBeGreaterThan(changed[2]);
    expect(recolour(toHsv(120, 120, 120), [{ source, range: z.range, offsets: z.colours.red }])).toBeNull();
  });
});
