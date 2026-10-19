import { describe, expect, it } from 'vitest';
import { normalizeSettings } from './settings';

describe('normalizeSettings', () => {
  it('returns defaults for missing or invalid values', () => {
    expect(normalizeSettings(undefined)).toEqual({
      enabled: true,
      pausedSites: [],
      scriptExceptions: [],
    });
    expect(normalizeSettings(null)).toEqual({
      enabled: true,
      pausedSites: [],
      scriptExceptions: [],
    });
    expect(normalizeSettings('nope')).toEqual({
      enabled: true,
      pausedSites: [],
      scriptExceptions: [],
    });
  });

  it('normalizes, deduplicates, and sorts paused sites', () => {
    const settings = normalizeSettings({
      enabled: false,
      pausedSites: [
        'https://www.example.com/path',
        'Example.COM',
        'foo.co.uk',
        'b.github.io',
        'b.github.io',
        'not a domain',
      ],
    });

    expect(settings).toEqual({
      enabled: false,
      pausedSites: ['b.github.io', 'example.com', 'foo.co.uk'],
      scriptExceptions: [],
    });
  });

  it('defaults enabled to true when the flag is not a boolean', () => {
    expect(normalizeSettings({ enabled: 'yes', pausedSites: [] }).enabled).toBe(
      true,
    );
  });

  it('normalizes and deduplicates script exceptions', () => {
    const settings = normalizeSettings({
      scriptExceptions: [
        {
          site: 'https://www.example.com/path',
          script: 'https://cdn.other.test/a.js?v=1',
        },
        {
          site: 'example.com',
          script: 'https://cdn.other.test/a.js#section',
        },
        {
          site: 'example.com',
          script: 'https://cdn.other.test/a.js',
        },
        { site: 'not a domain', script: 'https://cdn.other.test/b.js' },
        { site: 'example.com', script: 'javascript:alert(1)' },
        { site: 'example.com' },
        null,
      ],
    });

    expect(settings.scriptExceptions).toEqual([
      {
        site: 'example.com',
        script: 'https://cdn.other.test/a.js',
      },
    ]);
  });
});
