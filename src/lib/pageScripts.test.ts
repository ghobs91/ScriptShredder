import { describe, expect, it } from 'vitest';
import {
  collectBlockedScripts,
  describePageScripts,
  isScriptBlocked,
  listThirdPartyScripts,
} from './pageScripts';
import type { Settings } from './settings';

const pageUrl = 'https://www.example.com/page';
const rawScripts = [
  'https://www.example.com/app.js',
  'https://cdn.example.com/lib.js',
  'https://cdn.other.test/tracker.js?v=1',
  'https://cdn.other.test/tracker.js?v=2',
  'http://[::1]:3000/worker.js',
  'data:text/javascript,alert(1)',
];

function settings(patch: Partial<Settings> = {}): Settings {
  return {
    enabled: true,
    pausedSites: [],
    scriptExceptions: [],
    ...patch,
  };
}

describe('listThirdPartyScripts', () => {
  it('keeps only cross-site scripts and normalizes duplicates', () => {
    expect(listThirdPartyScripts(pageUrl, rawScripts)).toEqual([
      'http://[::1]:3000/worker.js',
      'https://cdn.other.test/tracker.js',
    ]);
  });

  it('returns nothing when the page URL is not usable', () => {
    expect(listThirdPartyScripts('chrome://extensions', rawScripts)).toEqual(
      [],
    );
  });
});

describe('describePageScripts', () => {
  it('marks third-party scripts as blocked by default', () => {
    expect(describePageScripts(pageUrl, rawScripts, settings())).toEqual([
      {
        script: 'http://[::1]:3000/worker.js',
        host: '[::1]:3000',
        path: '/worker.js',
        blocked: true,
      },
      {
        script: 'https://cdn.other.test/tracker.js',
        host: 'cdn.other.test',
        path: '/tracker.js',
        blocked: true,
      },
    ]);
  });

  it('marks an individually allowed script as allowed', () => {
    const result = describePageScripts(
      pageUrl,
      rawScripts,
      settings({
        scriptExceptions: [
          {
            site: 'example.com',
            script: 'https://cdn.other.test/tracker.js',
          },
        ],
      }),
    );

    expect(result).toEqual([
      {
        script: 'http://[::1]:3000/worker.js',
        host: '[::1]:3000',
        path: '/worker.js',
        blocked: true,
      },
      {
        script: 'https://cdn.other.test/tracker.js',
        host: 'cdn.other.test',
        path: '/tracker.js',
        blocked: false,
      },
    ]);
  });

  it('marks everything allowed when the site is paused or protection is off', () => {
    for (const value of [
      settings({ pausedSites: ['example.com'] }),
      settings({ enabled: false }),
    ]) {
      expect(
        describePageScripts(pageUrl, rawScripts, value).every(
          (script) => !script.blocked,
        ),
      ).toBe(true);
    }
  });
});

describe('collectBlockedScripts', () => {
  it('returns only scripts that are actually blocked', () => {
    expect(collectBlockedScripts(pageUrl, rawScripts, settings())).toEqual([
      'http://[::1]:3000/worker.js',
      'https://cdn.other.test/tracker.js',
    ]);

    expect(
      collectBlockedScripts(
        pageUrl,
        rawScripts,
        settings({
          scriptExceptions: [
            {
              site: 'example.com',
              script: 'https://cdn.other.test/tracker.js',
            },
          ],
        }),
      ),
    ).toEqual(['http://[::1]:3000/worker.js']);
  });

  it('returns nothing for a paused site', () => {
    expect(
      collectBlockedScripts(
        pageUrl,
        rawScripts,
        settings({ pausedSites: ['example.com'] }),
      ),
    ).toEqual([]);
  });
});

describe('isScriptBlocked', () => {
  it('requires an enabled, unpaused site without an exception', () => {
    const script = 'https://cdn.other.test/tracker.js';

    expect(isScriptBlocked(settings(), 'example.com', script)).toBe(true);
    expect(
      isScriptBlocked(settings({ enabled: false }), 'example.com', script),
    ).toBe(false);
    expect(
      isScriptBlocked(
        settings({ pausedSites: ['example.com'] }),
        'example.com',
        script,
      ),
    ).toBe(false);
    expect(
      isScriptBlocked(
        settings({
          scriptExceptions: [{ site: 'example.com', script }],
        }),
        'example.com',
        script,
      ),
    ).toBe(false);
  });
});
