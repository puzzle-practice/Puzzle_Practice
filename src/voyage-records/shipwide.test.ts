import { describe, expect, it } from 'vitest';
import sheet from './sheet-records.json';
import { crewSizeRows, otherCategories, sheetProblems, type SheetRecord } from './shipwide';

describe('shipwide records', () => {
  it('has a well-formed sheet-records.json', () => {
    expect(sheetProblems(sheet.records)).toEqual([]);
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
      for (const record of records) expect(record.pirateScores!.reduce((sum, share) => sum + share, 0)).toBe(Number(record.value));
    }
  });

  it('rejects screenshots outside the screenshots folder', () => {
    expect(sheetProblems([{ voyage: 'cursedIsles', ocean: 'emerald', category: 'X', value: '1', screenshot: 'https://i.imgur.com/a.png' }])).toHaveLength(1);
  });
});
