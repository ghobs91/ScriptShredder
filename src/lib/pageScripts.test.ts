import { describe, expect, it } from 'vitest';
import {
  collectBlockedScripts,
  describePageScripts,
  groupPageScripts,
  isScriptBlocked,
  listThirdPartyScripts,
} from './pageScripts';
import { DEFAULT_HARDENING, type Settings } from './settings';

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
    iframeExceptions: [],
    globalScriptExceptions: [],
    hardening: { ...DEFAULT_HARDENING },
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
        origin: 'http://[::1]:3000/',
        blocked: true,
        originAllowed: false,
        globalAllowed: false,
      },
      {
        script: 'https://cdn.other.test/tracker.js',
        host: 'cdn.other.test',
        path: '/tracker.js',
        origin: 'https://cdn.other.test/',
        blocked: true,
        originAllowed: false,
        globalAllowed: false,
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
        origin: 'http://[::1]:3000/',
        blocked: true,
        originAllowed: false,
        globalAllowed: false,
      },
      {
        script: 'https://cdn.other.test/tracker.js',
        host: 'cdn.other.test',
        path: '/tracker.js',
        origin: 'https://cdn.other.test/',
        blocked: false,
        originAllowed: false,
        globalAllowed: false,
      },
    ]);
  });

  it('marks every script on an allowed origin as allowed', () => {
    const result = describePageScripts(
      pageUrl,
      [...rawScripts, 'https://cdn.other.test/other/chunk.js'],
      settings({
        scriptExceptions: [
          { site: 'example.com', script: 'https://cdn.other.test/' },
        ],
      }),
    );

    const allowed = result.filter(
      (script) => script.origin === 'https://cdn.other.test/',
    );

    expect(allowed).toHaveLength(2);
    expect(allowed.every((script) => !script.blocked)).toBe(true);
    expect(allowed.every((script) => script.originAllowed)).toBe(true);
  });

  it('marks globally allowed scripts and hosts as allowed everywhere', () => {
    const result = describePageScripts(
      pageUrl,
      [
        'https://d111.cloudfront.net/assets/app.js',
        'https://cdn.other.test/tracker.js',
      ],
      settings({
        globalScriptExceptions: ['https://cloudfront.net/'],
      }),
    );

    const globalScript = result.find(
      (script) => script.host === 'd111.cloudfront.net',
    );
    expect(globalScript?.blocked).toBe(false);
    expect(globalScript?.globalAllowed).toBe(true);

    const groups = groupPageScripts(result);
    expect(
      groups.find((group) => group.host === 'd111.cloudfront.net')
        ?.globalAllowed,
    ).toBe(true);
    expect(
      groups.find((group) => group.host === 'cdn.other.test')?.globalAllowed,
    ).toBe(false);
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

  it('treats an origin exception as covering every path', () => {
    const value = settings({
      scriptExceptions: [
        { site: 'example.com', script: 'https://cdn.other.test/' },
      ],
    });

    expect(
      isScriptBlocked(
        value,
        'example.com',
        'https://cdn.other.test/assets/chunk.js',
      ),
    ).toBe(false);
    // A different origin on a similarly named host is not covered.
    expect(
      isScriptBlocked(
        value,
        'example.com',
        'https://cdn.other.test.evil.test/tracker.js',
      ),
    ).toBe(true);
    // The exception is scoped to the site that created it.
    expect(
      isScriptBlocked(
        value,
        'other.test',
        'https://cdn.other.test/assets/chunk.js',
      ),
    ).toBe(true);
  });
});

describe('groupPageScripts', () => {
  it('groups scripts by origin and lists blocked hosts first', () => {
    const scripts = describePageScripts(
      pageUrl,
      [
        'https://a.other.test/x.js',
        'https://b.other.test/y.js',
        'https://a.other.test/z.js',
      ],
      settings({
        scriptExceptions: [
          { site: 'example.com', script: 'https://b.other.test/' },
        ],
      }),
    );

    const groups = groupPageScripts(scripts);

    expect(groups.map((group) => group.host)).toEqual([
      'a.other.test',
      'b.other.test',
    ]);
    expect(groups[0]?.scripts.map((script) => script.path)).toEqual([
      '/x.js',
      '/z.js',
    ]);
    expect(groups[0]?.allowed).toBe(false);
    expect(groups[1]?.allowed).toBe(true);
    expect(groups[1]?.scripts.every((script) => !script.blocked)).toBe(true);
  });
});
