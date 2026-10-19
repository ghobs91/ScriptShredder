import { describe, expect, it } from 'vitest';
import { DEFAULT_HARDENING, normalizeSettings } from './settings';

const defaults = {
  enabled: true,
  pausedSites: [],
  scriptExceptions: [],
  iframeExceptions: [],
  hardening: { ...DEFAULT_HARDENING },
};

describe('normalizeSettings', () => {
  it('returns defaults for missing or invalid values', () => {
    expect(normalizeSettings(undefined)).toEqual(defaults);
    expect(normalizeSettings(null)).toEqual(defaults);
    expect(normalizeSettings('nope')).toEqual(defaults);
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
      ...defaults,
      enabled: false,
      pausedSites: ['b.github.io', 'example.com', 'foo.co.uk'],
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

  it('normalizes and deduplicates iframe exceptions', () => {
    const settings = normalizeSettings({
      iframeExceptions: [
        {
          site: 'https://www.example.com/path',
          frame: 'https://www.youtube.com/embed/abc?autoplay=1',
        },
        { site: 'example.com', frame: 'https://www.youtube.com' },
        { site: 'example.com', frame: 'https://www.youtube.com:443/' },
        { site: 'not a domain', frame: 'https://player.vimeo.com' },
        { site: 'example.com', frame: 'javascript:alert(1)' },
        { site: 'example.com' },
        null,
      ],
    });

    expect(settings.iframeExceptions).toEqual([
      { site: 'example.com', frame: 'https://www.youtube.com' },
    ]);
  });

  it('normalizes hardening defaults and boolean overrides', () => {
    expect(
      normalizeSettings({
        hardening: {
          blockBeacons: false,
          stripTrackingParams: false,
          removeThirdPartyReferer: true,
          sendGpc: false,
        },
      }).hardening,
    ).toEqual({
      ...DEFAULT_HARDENING,
      blockBeacons: false,
      stripTrackingParams: false,
      removeThirdPartyReferer: true,
      sendGpc: false,
    });
  });
});
