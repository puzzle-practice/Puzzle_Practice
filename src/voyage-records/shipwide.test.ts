import { describe, expect, it } from 'vitest';
import { crewSizeRows, otherCategories, screenshotsFor, sheetRecords, type SheetRecord } from './shipwide';

describe('shipwide records', () => {
  it('keeps every category but the den records apart, with values as text', () => {
    expect(sheetRecords.length).toBeGreaterThan(0);
    expect(sheetRecords.every((record) => typeof record.value === 'string')).toBe(true);
    expect(sheetRecords.some((record) => ['Best score', 'Most dire chests', 'Most cursed chests', 'Most immortal chests'].includes(record.category))).toBe(false);
  });

  it("takes a den record's screenshots from the record itself", () => {
    expect(screenshotsFor({ voyage: 'cursedIsles', ocean: 'emerald', crewSize: 7, kind: 'chests' })?.screenshot).toMatch(/^voyage-records\/screenshots\//);
  });

  it('puts best score and most chests for a crew size on one row', () => {
    const rows = crewSizeRows('woodhallow', 'emerald');
    const eight = rows.find((row) => row.crewSize === 8)!;
    expect(eight.score?.value).toBe(1762);
    expect(eight.chests?.value).toBe(127);
    expect(rows.map((row) => row.crewSize)).toEqual([...rows.map((row) => row.crewSize)].sort((a, b) => a - b));
  });

  it('groups other records by category, smallest crew first', () => {
    const records: SheetRecord[] = [
      { voyage: 'vampireLairs', ocean: 'emerald', category: 'Fastest', crewSize: 6, value: '20:00' },
      { voyage: 'vampireLairs', ocean: 'emerald', category: 'Fastest', crewSize: 3, value: '30:00' },
      { voyage: 'cursedIsles', ocean: 'emerald', category: 'Fastest', crewSize: 3, value: '10:00' },
    ];
    const groups = otherCategories('vampireLairs', 'emerald', records);
    expect([...groups.keys()]).toEqual(['Fastest']);
    expect(groups.get('Fastest')!.map((record) => record.crewSize)).toEqual([3, 6]);
  });

  it('splits the Woodhallow duty report records by crew size, so they show as crew table columns', () => {
    const groups = otherCategories('woodhallow', 'emerald');
    for (const category of ['Most dire chests in one DR', 'Best forage score in one DR']) {
      const records = groups.get(category)!;
      expect(records.length).toBeGreaterThan(0);
      expect(records.every((record) => record.crewSize !== undefined)).toBe(true);
      // Records sent in without each forager's share leave pirateScores out.
      for (const record of records) {
        if (record.pirateScores) expect(record.pirateScores.reduce((sum, share) => sum + share, 0)).toBe(Number(record.value));
      }
    }
  });
});
