import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATS,
  incrementStats,
  normalizeStats,
} from './stats';

const at = 1_700_000_000_000;

describe('normalizeStats', () => {
  it('returns an empty record for invalid input', () => {
    expect(normalizeStats(undefined)).toEqual(EMPTY_STATS);
    expect(normalizeStats(null)).toEqual(EMPTY_STATS);
    expect(normalizeStats('nope')).toEqual(EMPTY_STATS);
  });

  it('deduplicates entries and drops invalid ones', () => {
    expect(
      normalizeStats({
        total: 4,
        scripts: [
          {
            script: 'https://cdn.test/a.js?v=1',
            count: 1,
            lastBlockedAt: at,
          },
          {
            script: 'https://cdn.test/a.js?v=2',
            count: 2,
            lastBlockedAt: at + 10,
          },
          {
            script: 'javascript:alert(1)',
            count: 5,
            lastBlockedAt: at,
          },
          { script: 'https://cdn.test/b.js', count: 0, lastBlockedAt: at },
          { script: 'https://cdn.test/c.js', count: 1 },
        ],
      }),
    ).toEqual({
      total: 4,
      scripts: [
        {
          script: 'https://cdn.test/a.js',
          count: 3,
          lastBlockedAt: at + 10,
        },
      ],
    });
  });
});

describe('incrementStats', () => {
  it('counts unique normalized scripts and updates the total', () => {
    const next = incrementStats(
      EMPTY_STATS,
      [
        'https://cdn.test/a.js?v=1',
        'https://cdn.test/a.js?v=2',
        'https://cdn.test/b.js',
      ],
      at,
    );

    expect(next.total).toBe(2);
    expect(next.scripts).toEqual([
      { script: 'https://cdn.test/a.js', count: 1, lastBlockedAt: at },
      { script: 'https://cdn.test/b.js', count: 1, lastBlockedAt: at },
    ]);
  });

  it('increments existing counts and last-blocked timestamps', () => {
    const first = incrementStats(
      EMPTY_STATS,
      ['https://cdn.test/a.js'],
      at,
    );
    const second = incrementStats(first, ['https://cdn.test/a.js'], at + 1000);

    expect(second.total).toBe(2);
    expect(second.scripts).toEqual([
      {
        script: 'https://cdn.test/a.js',
        count: 2,
        lastBlockedAt: at + 1000,
      },
    ]);
  });

  it('ignores invalid scripts', () => {
    expect(
      incrementStats(
        EMPTY_STATS,
        ['data:text/javascript,alert(1)', 'not a url'],
        at,
      ),
    ).toEqual(EMPTY_STATS);
  });

  it('caps the tracked list while still counting every block', () => {
    const scripts = Array.from(
      { length: 501 },
      (_, index) => `https://cdn.test/${index}.js`,
    );
    const next = incrementStats(EMPTY_STATS, scripts, at);

    expect(next.total).toBe(501);
    expect(next.scripts).toHaveLength(500);
  });
});
