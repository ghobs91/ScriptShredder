import { describe, expect, it } from 'vitest';
import {
  buildPageActions,
  EMPTY_ACTIVITY,
  groupPageActions,
  isPageAction,
  isPageActivity,
  summarizePageActions,
  type PageActionInput,
} from './actions';
import { DEFAULT_HARDENING, type HardeningSettings } from './settings';

const pageUrl = 'https://site.test/';

function input(patch: Partial<PageActionInput> = {}): PageActionInput {
  return {
    pageUrl,
    site: 'site.test',
    enabled: true,
    paused: false,
    hardening: { ...DEFAULT_HARDENING },
    scriptExceptions: [],
    globalScriptExceptions: [],
    scripts: [],
    frames: [],
    beacons: [],
    resources: [],
    cleanups: [],
    ...patch,
  };
}

function hardening(
  patch: Partial<HardeningSettings>,
): HardeningSettings {
  return { ...DEFAULT_HARDENING, ...patch };
}

describe('buildPageActions', () => {
  it('returns nothing while protection is off or the site is paused', () => {
    expect(buildPageActions(input({ enabled: false }))).toEqual([]);
    expect(buildPageActions(input({ paused: true }))).toEqual([]);
  });

  it('lists blocked third-party scripts and skips first-party scripts', () => {
    const actions = buildPageActions(
      input({
        scripts: [
          'https://site.test/app.js',
          'https://cdn.other.test/a.js',
          'https://cdn.other.test/b.js',
        ],
      }),
    ).filter((action) => action.kind === 'script');

    expect(actions).toEqual([
      { kind: 'script', url: 'https://cdn.other.test/a.js' },
      { kind: 'script', url: 'https://cdn.other.test/b.js' },
    ]);
  });

  it('honors origin exceptions for scripts', () => {
    expect(
      buildPageActions(
        input({
          scripts: ['https://cdn.other.test/a.js'],
          scriptExceptions: ['https://cdn.other.test/'],
        }),
      ).filter((action) => action.kind === 'script'),
    ).toEqual([]);
  });

  it('skips scripts covered by a global exception', () => {
    expect(
      buildPageActions(
        input({
          scripts: [
            'https://d111.cloudfront.net/app.js',
            'https://cdn.other.test/tracker.js',
          ],
          globalScriptExceptions: ['https://cloudfront.net/'],
        }),
      ).filter((action) => action.kind === 'script'),
    ).toEqual([{ kind: 'script', url: 'https://cdn.other.test/tracker.js' }]);
  });

  it('lists blocked embeds and removed ping attributes', () => {
    const actions = buildPageActions(
      input({
        frames: ['https://widget.test/embed.html'],
        beacons: ['https://cdn.other.test/ping'],
      }),
    ).filter(
      (action) => action.kind === 'iframe' || action.kind === 'beacon',
    );

    expect(actions).toEqual([
      { kind: 'iframe', url: 'https://widget.test/embed.html' },
      { kind: 'beacon', url: 'https://cdn.other.test/ping' },
    ]);
  });

  it('counts privacy headers only on third-party requests that loaded', () => {
    const actions = buildPageActions(
      input({
        scripts: ['https://cdn.other.test/blocked.js'],
        frames: ['https://widget.test/embed.html'],
        resources: [
          'https://cdn.other.test/blocked.js',
          'https://site.test/app.js',
          'https://cdn.other.test/loaded.js',
          'https://widget.test/embed.html',
        ],
      }),
    ).filter((action) => action.kind === 'headers');

    expect(actions).toEqual([
      { kind: 'headers', url: 'https://cdn.other.test', count: 1 },
    ]);
  });

  it('counts Sec-GPC on the document and third-party origins', () => {
    const actions = buildPageActions(
      input({
        scripts: ['https://cdn.other.test/blocked.js'],
        resources: [
          'https://cdn.other.test/blocked.js',
          'https://site.test/app.js',
          'https://cdn.other.test/loaded.js',
        ],
        hardening: hardening({ sendGpc: true }),
      }),
    ).filter((action) => action.kind === 'gpc');

    expect(actions).toEqual([
      { kind: 'gpc', url: pageUrl },
      { kind: 'gpc', url: 'https://cdn.other.test', count: 1 },
    ]);
  });

  it('aggregates repeated header and GPC requests by origin', () => {
    const actions = buildPageActions(
      input({
        resources: [
          'https://cdn.other.test/a.js',
          'https://cdn.other.test/b.js',
          'https://widget.test/x.js',
          'https://cdn.other.test/a.js',
        ],
      }),
    );

    expect(actions.filter((action) => action.kind === 'headers')).toEqual([
      { kind: 'headers', url: 'https://cdn.other.test', count: 3 },
      { kind: 'headers', url: 'https://widget.test', count: 1 },
    ]);
    expect(actions.filter((action) => action.kind === 'gpc')).toEqual([
      { kind: 'gpc', url: pageUrl },
      { kind: 'gpc', url: 'https://cdn.other.test', count: 3 },
      { kind: 'gpc', url: 'https://widget.test', count: 1 },
    ]);
  });

  it('omits header and GPC actions when those settings are off', () => {
    const actions = buildPageActions(
      input({
        resources: ['https://cdn.other.test/loaded.js'],
        hardening: hardening({
          sendGpc: false,
          reduceFingerprintHeaders: false,
          removeThirdPartyReferer: false,
        }),
      }),
    );

    expect(actions).toEqual([]);
  });

  it('deduplicates tracking cleanups', () => {
    const actions = buildPageActions(
      input({
        cleanups: [
          { from: 'https://site.test/?utm_source=a', to: 'https://site.test/' },
          { from: 'https://site.test/?utm_source=a', to: 'https://site.test/' },
          { from: 'https://site.test/?fbclid=b', to: 'https://site.test/' },
        ],
        hardening: hardening({ stripTrackingParams: true }),
      }),
    ).filter((action) => action.kind === 'tracking');

    expect(actions).toEqual([
      {
        kind: 'tracking',
        url: 'https://site.test/?utm_source=a',
        cleaned: 'https://site.test/',
      },
      {
        kind: 'tracking',
        url: 'https://site.test/?fbclid=b',
        cleaned: 'https://site.test/',
      },
    ]);
  });
});

describe('groupPageActions', () => {
  it('groups by kind, deduplicates URLs, and keeps total request counts', () => {
    const groups = groupPageActions([
      { kind: 'gpc', url: 'https://cdn.test/a.js' },
      { kind: 'gpc', url: 'https://cdn.test/a.js' },
      { kind: 'gpc', url: 'https://cdn.test/b.js' },
      { kind: 'headers', url: 'https://cdn.test/a.js' },
    ]);

    expect(groups).toEqual([
      {
        kind: 'headers',
        count: 1,
        distinct: 1,
        items: [{ url: 'https://cdn.test/a.js', count: 1 }],
      },
      {
        kind: 'gpc',
        count: 3,
        distinct: 2,
        items: [
          { url: 'https://cdn.test/a.js', count: 2 },
          { url: 'https://cdn.test/b.js', count: 1 },
        ],
      },
    ]);
  });

  it('uses aggregated action counts for requests and items', () => {
    const groups = groupPageActions([
      { kind: 'headers', url: 'https://cdn.test', count: 42 },
    ]);

    expect(groups).toEqual([
      {
        kind: 'headers',
        count: 42,
        distinct: 1,
        items: [{ url: 'https://cdn.test', count: 42 }],
      },
    ]);
  });

  it('keeps tracking cleanups distinct by source and result', () => {
    const groups = groupPageActions([
      {
        kind: 'tracking',
        url: 'https://site.test/?utm_source=a',
        cleaned: 'https://site.test/',
      },
      {
        kind: 'tracking',
        url: 'https://site.test/?utm_source=a',
        cleaned: 'https://site.test/',
      },
    ]);

    expect(groups).toEqual([
      {
        kind: 'tracking',
        count: 2,
        distinct: 1,
        items: [
          {
            url: 'https://site.test/?utm_source=a',
            cleaned: 'https://site.test/',
            count: 2,
          },
        ],
      },
    ]);
  });
});

describe('summarizePageActions', () => {
  it('separates distinct items from raw requests', () => {
    const activity = summarizePageActions([
      { kind: 'script', url: 'https://cdn.test/a.js' },
      { kind: 'headers', url: 'https://cdn.test', count: 10 },
      { kind: 'gpc', url: pageUrl },
      { kind: 'gpc', url: 'https://cdn.test', count: 9 },
    ]);

    expect(activity.total).toBe(4);
    expect(activity.requests).toBe(21);
    expect(activity.groups).toHaveLength(3);
  });

  it('returns an empty activity for no actions', () => {
    expect(summarizePageActions([])).toEqual(EMPTY_ACTIVITY);
  });
});

describe('isPageAction', () => {
  it('accepts valid actions and rejects malformed values', () => {
    expect(isPageAction({ kind: 'script', url: 'https://cdn.test/a.js' })).toBe(
      true,
    );
    expect(
      isPageAction({
        kind: 'tracking',
        url: 'https://site.test/?utm_source=a',
        cleaned: 'https://site.test/',
      }),
    ).toBe(true);
    expect(isPageAction({ kind: 'other', url: 'https://cdn.test/a.js' })).toBe(
      false,
    );
    expect(isPageAction({ kind: 'script' })).toBe(false);
    expect(isPageAction(null)).toBe(false);
  });
});

describe('isPageActivity', () => {
  it('accepts a summarized activity and rejects malformed values', () => {
    const activity = summarizePageActions([
      { kind: 'headers', url: 'https://cdn.test', count: 4 },
    ]);

    expect(isPageActivity(activity)).toBe(true);
    expect(isPageActivity({ total: 1, requests: 4, groups: [] })).toBe(true);
    expect(isPageActivity({ total: '1', requests: 4, groups: [] })).toBe(false);
    expect(
      isPageActivity({
        total: 1,
        requests: 4,
        groups: [{ kind: 'headers', count: 4, items: [] }],
      }),
    ).toBe(false);
    expect(isPageActivity(null)).toBe(false);
  });
});
