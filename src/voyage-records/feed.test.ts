import { describe, expect, it } from 'vitest';
import { FEED_VERSION, recordsFeed } from './feed';
import { knownRecords } from './known-records';
import { sheetRecords } from './shipwide';

describe('records feed', () => {
  const feed = recordsFeed({ now: new Date('2026-11-13T12:00:00Z') });

  it('holds every record from both tables', () => {
    expect(feed.version).toBe(FEED_VERSION);
    expect(feed.generated).toBe('2026-11-13T12:00:00.000Z');
    expect(feed.crewSizeRecords).toHaveLength(knownRecords.length);
    expect(feed.otherRecords).toHaveLength(sheetRecords.length);
    expect(feed.voyages.map((voyage) => voyage.id)).toEqual(['woodhallow', 'cursedIsles', 'vampireLairs']);
  });

  it('gives every record its own id', () => {
    const ids = [...feed.crewSizeRecords, ...feed.otherRecords].map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('writes crew-size records in a steady, readable shape', () => {
    const feed = recordsFeed({
      other: [],
      known: [
        { voyage: 'vampireLairs', ocean: 'emerald', crewSize: 2, kind: 'score', value: 30 },
        { voyage: 'woodhallow', ocean: 'emerald', crewSize: 3, kind: 'chests', value: 67, date: '2026-10-29', pirates: ['Jice'], source: 'chatlog' },
      ],
    });
    expect(feed.crewSizeRecords.map((record) => record.voyage)).toEqual(['woodhallow', 'vampireLairs']);
    expect(feed.crewSizeRecords[0]).toMatchObject({
      id: 'woodhallow/emerald/3/chests', label: 'Most dire chests', value: 67, date: '2026-10-29', pirates: ['Jice'], source: 'chatlog',
    });
    expect(feed.crewSizeRecords[1]).toMatchObject({ label: 'Best score', date: null, pirates: [], source: null });
  });

  it('numbers repeated categories so ids stay unique', () => {
    const tie = { voyage: 'cursedIsles' as const, ocean: 'emerald', category: 'Most frays in one entry', crewSize: 1, value: '37 frays' };
    const feed = recordsFeed({ known: [], other: [tie, { ...tie, pirates: ['Rock'], screenshot: 'voyage-records/screenshots/a.png', more: ['voyage-records/screenshots/b.png'] }] });
    expect(feed.otherRecords.map((record) => record.id)).toEqual([
      'cursedIsles/emerald/most-frays-in-one-entry/1',
      'cursedIsles/emerald/most-frays-in-one-entry/1/2',
    ]);
    expect(feed.otherRecords[1].screenshots).toEqual(['voyage-records/screenshots/a.png', 'voyage-records/screenshots/b.png']);
  });

  it('keeps screenshot paths relative to the site root, where the feed sits', () => {
    for (const record of [...feed.crewSizeRecords, ...feed.otherRecords]) {
      for (const shot of record.screenshots) expect(shot).toMatch(/^voyage-records\/screenshots\//);
    }
  });
});
