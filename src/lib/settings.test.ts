import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_SCRIPT_EXCEPTIONS } from './globalScripts';
import {
  DEFAULT_HARDENING,
  hasGlobalScriptException,
  hasScriptException,
  normalizeSettings,
} from './settings';

const defaults = {
  enabled: true,
  pausedSites: [],
  scriptExceptions: [],
  iframeExceptions: [],
  globalScriptExceptions: [...DEFAULT_GLOBAL_SCRIPT_EXCEPTIONS],
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

  it('normalizes and deduplicates global script exceptions', () => {
    const settings = normalizeSettings({
      globalScriptExceptions: [
        'cloudfront.net',
        'https://cdn.other.test',
        'https://www.google.com/recaptcha/',
        'cloudfront.net',
        'not a host',
      ],
    });

    expect(settings.globalScriptExceptions).toEqual([
      'https://cloudfront.net/',
      'https://cdn.other.test/',
      'https://www.google.com/recaptcha/',
    ]);
  });

  it('keeps an explicit empty global list instead of re-adding defaults', () => {
    expect(
      normalizeSettings({ globalScriptExceptions: [] }).globalScriptExceptions,
    ).toEqual([]);
  });

  it('seeds the recommended global hosts when the key is missing', () => {
    expect(normalizeSettings({ enabled: true }).globalScriptExceptions).toEqual(
      [...DEFAULT_GLOBAL_SCRIPT_EXCEPTIONS],
    );
  });

  it('normalizes an origin exception to a trailing-slash URL', () => {
    expect(
      normalizeSettings({
        scriptExceptions: [
          { site: 'example.com', script: 'https://cdn.other.test' },
        ],
      }).scriptExceptions,
    ).toEqual([
      { site: 'example.com', script: 'https://cdn.other.test/' },
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

describe('hasScriptException', () => {
  it('covers every path on an origin exception for that site only', () => {
    const settings = normalizeSettings({
      scriptExceptions: [
        { site: 'example.com', script: 'https://cdn.other.test' },
      ],
    });

    expect(
      hasScriptException(settings, 'example.com', 'https://cdn.other.test/'),
    ).toBe(true);
    expect(
      hasScriptException(
        settings,
        'example.com',
        'https://cdn.other.test/assets/chunk.js',
      ),
    ).toBe(true);
    expect(
      hasScriptException(
        settings,
        'example.com',
        'https://cdn.other.test.evil.test/tracker.js',
      ),
    ).toBe(false);
    expect(
      hasScriptException(
        settings,
        'other.test',
        'https://cdn.other.test/assets/chunk.js',
      ),
    ).toBe(false);
  });

  it('only matches a path exception exactly', () => {
    const settings = normalizeSettings({
      scriptExceptions: [
        { site: 'example.com', script: 'https://cdn.other.test/app.js' },
      ],
    });

    expect(
      hasScriptException(
        settings,
        'example.com',
        'https://cdn.other.test/app.js',
      ),
    ).toBe(true);
    expect(
      hasScriptException(
        settings,
        'example.com',
        'https://cdn.other.test/app.js/v2.js',
      ),
    ).toBe(false);
  });
});

describe('hasGlobalScriptException', () => {
  it('covers the host, subdomains, and path-scoped entries everywhere', () => {
    const settings = normalizeSettings({
      globalScriptExceptions: [
        'cloudfront.net',
        'https://www.google.com/recaptcha/',
      ],
    });

    expect(
      hasGlobalScriptException(
        settings,
        'https://d111.cloudfront.net/assets/app.js',
      ),
    ).toBe(true);
    expect(
      hasGlobalScriptException(
        settings,
        'https://www.google.com/recaptcha/api.js',
      ),
    ).toBe(true);
    expect(
      hasGlobalScriptException(
        settings,
        'https://www.google.com/other/app.js',
      ),
    ).toBe(false);
    expect(
      hasGlobalScriptException(
        settings,
        'https://cloudfront.net.evil.test/app.js',
      ),
    ).toBe(false);
  });
});
