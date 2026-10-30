import {
  expect,
  test,
  chromium,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import path from 'node:path';

const extensionPath = path.resolve('.output/chrome-mv3');
const trackerUrl = 'http://cdn.test:4173/tracker.js';
const embedOrigin = 'http://widget.test:4173';

type Flags = {
  firstPartyLoaded?: boolean;
  sameSiteLoaded?: boolean;
  thirdPartyLoaded?: boolean;
};

type BlockedStats = {
  total: number;
  scripts: Array<{
    script: string;
    count: number;
    lastBlockedAt: number;
  }>;
};

type Settings = {
  iframeExceptions?: Array<{ site: string; frame: string }>;
};

type ImageHeaders = {
  image: Record<string, string> | null;
};

async function readFlags(page: Page): Promise<Flags> {
  return page.evaluate(() => ({
    firstPartyLoaded: (window as unknown as Record<string, unknown>)
      .firstPartyLoaded as boolean | undefined,
    sameSiteLoaded: (window as unknown as Record<string, unknown>)
      .sameSiteLoaded as boolean | undefined,
    thirdPartyLoaded: (window as unknown as Record<string, unknown>)
      .thirdPartyLoaded as boolean | undefined,
  }));
}

async function getWorker(context: BrowserContext) {
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  }
  return worker;
}

async function getDynamicRules(context: BrowserContext) {
  const worker = await getWorker(context);
  return worker.evaluate(() =>
    chrome.declarativeNetRequest.getDynamicRules(),
  );
}

async function getBlockRule(context: BrowserContext) {
  return (await getDynamicRules(context)).find((rule) => rule.id === 1);
}

async function getStats(context: BrowserContext): Promise<BlockedStats | null> {
  const worker = await getWorker(context);
  return worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('blockedStats');
    return (stored.blockedStats as BlockedStats | undefined) ?? null;
  });
}

async function getSettings(context: BrowserContext): Promise<Settings | null> {
  const worker = await getWorker(context);
  return worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('settings');
    return (stored.settings as Settings | undefined) ?? null;
  });
}

async function getPageScripts(
  context: BrowserContext,
): Promise<{
  pageUrl: string;
  scripts: string[];
  activity: { total: number; requests: number };
} | null> {
  const worker = await getWorker(context);
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) return null;

    return (await chrome.tabs.sendMessage(tab.id, {
      type: 'scriptshredder:get-page-scripts',
    })) as {
      pageUrl: string;
      scripts: string[];
      activity: { total: number; requests: number };
    };
  });
}

async function getBadgeText(context: BrowserContext): Promise<string> {
  const worker = await getWorker(context);
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) return '';
    return chrome.action.getBadgeText({ tabId: tab.id });
  });
}

async function getBadgeSnapshot(
  context: BrowserContext,
): Promise<{ badge: string; count: number } | null> {
  const worker = await getWorker(context);
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) return null;

    const response = (await chrome.tabs.sendMessage(tab.id, {
      type: 'scriptshredder:get-page-scripts',
    })) as { activity: { total: number } };
    const badge = await chrome.action.getBadgeText({ tabId: tab.id });

    return { badge, count: response.activity.total };
  });
}

async function openOptions(context: BrowserContext) {
  const worker = await getWorker(context);
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(
    page.getByRole('heading', { name: /Keep each site/ }),
  ).toBeVisible();
  return page;
}

async function openSite(context: BrowserContext, pathname = '/') {
  const page = await context.newPage();
  await page.goto(`http://site.test:4173${pathname}`, { waitUntil: 'load' });
  return page;
}

async function fetchImageHeaders(): Promise<ImageHeaders> {
  const response = await fetch('http://127.0.0.1:4173/headers.json');
  return (await response.json()) as ImageHeaders;
}

async function resetImageHeaders(): Promise<void> {
  await fetch('http://127.0.0.1:4173/reset-headers');
}

async function fetchPageUrl(): Promise<{ url: string | null }> {
  const response = await fetch('http://127.0.0.1:4173/page-url.json');
  return (await response.json()) as { url: string | null };
}

async function resetPageUrl(): Promise<void> {
  await fetch('http://127.0.0.1:4173/reset-page-url');
}

test.describe('third-party script blocking', () => {
  let context: BrowserContext;

  test.beforeEach(async () => {
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--host-resolver-rules=MAP site.test 127.0.0.1, MAP api.site.test 127.0.0.1, MAP cdn.test 127.0.0.1, MAP widget.test 127.0.0.1',
      ],
    });
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('blocks third-party scripts but allows first-party and same-site scripts', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const page = await openSite(context);
    const flags = await readFlags(page);

    expect(flags.firstPartyLoaded).toBe(true);
    expect(flags.sameSiteLoaded).toBe(true);
    expect(flags.thirdPartyLoaded).toBeUndefined();
  });

  test('toolbar badge matches the blocked and modified action list', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const page = await openSite(context);
    await page.waitForTimeout(700);

    await expect
      .poll(async () => {
        const snapshot = await getBadgeSnapshot(context);
        return (
          snapshot !== null &&
          snapshot.count > 0 &&
          snapshot.badge === String(snapshot.count)
        );
      })
      .toBe(true);
  });

  test('lists page scripts and records local blocked-script counters', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const page = await openSite(context);
    await page.waitForTimeout(700);

    await expect
      .poll(async () => (await getPageScripts(context))?.scripts ?? [])
      .toContain(trackerUrl);

    const pageScripts = await getPageScripts(context);
    expect(pageScripts?.scripts).toContain(
      'http://api.site.test:4173/same-site.js',
    );

    await expect
      .poll(async () => (await getStats(context))?.total ?? 0)
      .toBe(1);

    const stats = await getStats(context);
    expect(stats?.scripts).toEqual([
      {
        script: trackerUrl,
        count: 1,
        lastBlockedAt: expect.any(Number),
      },
    ]);

    const options = await openOptions(context);
    await expect(
      options.getByRole('heading', { name: /Most blocked scripts/ }),
    ).toBeVisible();
    await expect(options.getByTitle(trackerUrl)).toBeVisible();
    await expect(
      options.getByText('total block events recorded'),
    ).toBeVisible();
  });

  test('background acknowledges a rule-sync request', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const options = await openOptions(context);
    const response = await options.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'scriptshredder:sync-rules' }),
    );

    expect(response).toEqual({ ok: true });
  });

  test('pausing a site through settings allows its third-party scripts', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const options = await openOptions(context);
    await options.getByLabel('Site to pause').fill('site.test');
    await options.getByRole('button', { name: 'Pause site' }).click();

    await expect(options.getByText(/Paused on site\.test\./)).toBeVisible();
    await expect
      .poll(async () =>
        (await getDynamicRules(context)).some(
          (rule) => rule.action.type === 'allowAllRequests',
        ),
      )
      .toBe(true);

    const page = await openSite(context);
    const flags = await readFlags(page);

    expect(flags.firstPartyLoaded).toBe(true);
    expect(flags.thirdPartyLoaded).toBe(true);

    await page.waitForTimeout(700);
    expect((await getStats(context))?.total ?? 0).toBe(0);
    await expect.poll(async () => getBadgeText(context)).toBe('');
  });

  test('turning protection off allows all scripts', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const options = await openOptions(context);
    await options
      .getByRole('switch', { name: 'Turn protection off' })
      .click();

    await expect
      .poll(async () => (await getDynamicRules(context)).length)
      .toBe(0);

    const page = await openSite(context);
    const flags = await readFlags(page);

    expect(flags.firstPartyLoaded).toBe(true);
    expect(flags.thirdPartyLoaded).toBe(true);
  });

  test('allows a single script on a site, then blocks it again', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const options = await openOptions(context);
    await options.evaluate(async (script) => {
      await chrome.storage.local.set({
        settings: {
          enabled: true,
          pausedSites: [],
          scriptExceptions: [{ site: 'site.test', script }],
        },
      });
    }, trackerUrl);

    await expect
      .poll(async () =>
        (await getDynamicRules(context)).some(
          (rule) =>
            rule.id >= 2000 &&
            rule.id < 3000 &&
            rule.action.type === 'allow',
        ),
      )
      .toBe(true);

    let page = await openSite(context);
    let flags = await readFlags(page);

    expect(flags.firstPartyLoaded).toBe(true);
    expect(flags.thirdPartyLoaded).toBe(true);

    await page.waitForTimeout(700);
    expect((await getStats(context))?.total ?? 0).toBe(0);

    await expect(
      options.locator('.exception-script', { hasText: trackerUrl }),
    ).toBeVisible();
    await options
      .getByRole('button', {
        name: `Block ${trackerUrl} on site.test again`,
      })
      .click();

    await expect
      .poll(async () =>
        (await getDynamicRules(context)).some(
          (rule) =>
            rule.id >= 2000 &&
            rule.id < 3000 &&
            rule.action.type === 'allow',
        ),
      )
      .toBe(false);

    page = await openSite(context);
    flags = await readFlags(page);

    expect(flags.thirdPartyLoaded).toBeUndefined();
  });

  test('allows every script from an origin on a site, then blocks them again', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const options = await openOptions(context);
    const origin = 'http://cdn.test:4173/';
    const originLabel = 'http://cdn.test:4173/*';

    await options.evaluate(async (script) => {
      await chrome.storage.local.set({
        settings: {
          enabled: true,
          pausedSites: [],
          scriptExceptions: [{ site: 'site.test', script }],
        },
      });
    }, origin);

    await expect
      .poll(async () =>
        (await getDynamicRules(context)).some(
          (rule) =>
            rule.id >= 2000 &&
            rule.id < 3000 &&
            rule.action.type === 'allow',
        ),
      )
      .toBe(true);

    let page = await openSite(context);
    let flags = await readFlags(page);

    expect(flags.firstPartyLoaded).toBe(true);
    expect(flags.thirdPartyLoaded).toBe(true);

    await page.waitForTimeout(700);
    expect((await getStats(context))?.total ?? 0).toBe(0);

    await expect(
      options.locator('.exception-script', { hasText: originLabel }),
    ).toBeVisible();
    await options
      .getByRole('button', {
        name: `Block ${originLabel} on site.test again`,
      })
      .click();

    await expect
      .poll(async () =>
        (await getDynamicRules(context)).some(
          (rule) =>
            rule.id >= 2000 &&
            rule.id < 3000 &&
            rule.action.type === 'allow',
        ),
      )
      .toBe(false);

    page = await openSite(context);
    flags = await readFlags(page);

    expect(flags.thirdPartyLoaded).toBeUndefined();
  });

  test('allows a host on every site, then blocks it everywhere again', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const options = await openOptions(context);
    await options.getByLabel('Host to allow everywhere').fill('cdn.test');
    await options.getByRole('button', { name: 'Allow everywhere' }).click();

    await expect(
      options.getByText(/Allowing https:\/\/cdn\.test\/\* on every site/),
    ).toBeVisible();
    await expect
      .poll(async () =>
        (await getDynamicRules(context)).some(
          (rule) => rule.condition.urlFilter === '||cdn.test^',
        ),
      )
      .toBe(true);

    let page = await openSite(context);
    let flags = await readFlags(page);

    expect(flags.firstPartyLoaded).toBe(true);
    expect(flags.thirdPartyLoaded).toBe(true);

    await page.waitForTimeout(700);
    expect((await getStats(context))?.total ?? 0).toBe(0);

    await options
      .getByRole('button', {
        name: 'Stop allowing https://cdn.test/* everywhere',
      })
      .click();

    await expect
      .poll(async () =>
        (await getDynamicRules(context)).some(
          (rule) => rule.condition.urlFilter === '||cdn.test^',
        ),
      )
      .toBe(false);

    page = await openSite(context);
    flags = await readFlags(page);

    expect(flags.firstPartyLoaded).toBe(true);
    expect(flags.thirdPartyLoaded).toBeUndefined();
  });

  test('loads a globally allowed third-party embed without a placeholder', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const options = await openOptions(context);
    await options.getByLabel('Host to allow everywhere').fill('widget.test');
    await options.getByRole('button', { name: 'Allow everywhere' }).click();
    await expect(
      options.getByText(/Allowing https:\/\/widget\.test\/\* on every site/),
    ).toBeVisible();

    const page = await openSite(context);
    const frame = page.frameLocator('iframe[title="Test embed"]');

    await expect(frame.getByText('EMBED_LOADED')).toBeVisible();
    await expect(page.locator('[data-scriptshredder-embed]')).toHaveCount(0);
  });

  test('removing a paused site blocks it again', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const options = await openOptions(context);
    await options.getByLabel('Site to pause').fill('site.test');
    await options.getByRole('button', { name: 'Pause site' }).click();
    await expect(options.getByText(/Paused on site\.test\./)).toBeVisible();

    await options
      .getByRole('button', { name: 'Remove site.test from paused sites' })
      .click();
    await expect
      .poll(async () =>
        (await getDynamicRules(context)).some(
          (rule) => rule.action.type === 'allowAllRequests',
        ),
      )
      .toBe(false);

    const page = await openSite(context);
    const flags = await readFlags(page);

    expect(flags.firstPartyLoaded).toBe(true);
    expect(flags.thirdPartyLoaded).toBeUndefined();
  });

  test('strips tracking parameters from the current URL and link clicks', async () => {
    await expect
      .poll(async () =>
        (await getDynamicRules(context)).some(
          (rule) => rule.id >= 5000 && rule.id < 6000,
        ),
      )
      .toBe(true);

    await resetPageUrl();

    const page = await openSite(
      context,
      '/?utm_source=test&fbclid=abc&keep=1',
    );

    await expect
      .poll(() => page.url())
      .toBe('http://site.test:4173/?keep=1');

    await expect
      .poll(async () => (await fetchPageUrl()).url)
      .toBe('/?keep=1');

    await page.getByRole('link', { name: 'Tracking link' }).click();
    await expect
      .poll(() => page.url())
      .toBe('http://site.test:4173/clean?keep=1');
  });

  test('removes third-party speculation links and ping attributes', async () => {
    const page = await openSite(context);

    await expect
      .poll(
        async () =>
          page.locator('link[rel="preconnect"][href*="cdn.test"]').count(),
      )
      .toBe(0);
    await expect
      .poll(
        async () =>
          page.locator('link[rel="dns-prefetch"][href*="cdn.test"]').count(),
      )
      .toBe(0);
    await expect
      .poll(
        async () =>
          page.locator('link[rel="prefetch"][href*="cdn.test"]').count(),
      )
      .toBe(0);

    await expect(
      page.locator('link[rel="preconnect"][href*="api.site.test"]'),
    ).toHaveCount(1);
    await expect
      .poll(async () => page.locator('#ping-link').getAttribute('ping'))
      .toBeNull();
    await expect
      .poll(async () => page.locator('img[alt=""]').getAttribute('attributionsrc'))
      .toBeNull();
  });

  test('click-to-loads a third-party embed and remembers it per site', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const page = await openSite(context);
    const host = page.locator(
      `[data-scriptshredder-embed="${embedOrigin}"]`,
    );

    await expect(host).toBeVisible();

    await host.locator('button').click();

    await expect
      .poll(() =>
        page.frames().some((frame) => frame.url().includes('widget.test')),
      )
      .toBe(true);

    const frame = page.frames().find((value) =>
      value.url().includes('widget.test'),
    );
    expect(frame).toBeDefined();
    await expect(frame!.getByText('EMBED_LOADED')).toBeVisible();

    const settings = await getSettings(context);
    expect(settings?.iframeExceptions).toContainEqual({
      site: 'site.test',
      frame: embedOrigin,
    });

    const options = await openOptions(context);
    await expect(
      options.getByRole('heading', { name: 'Allowed embeds' }),
    ).toBeVisible();
    await expect(
      options.locator('.exception-script', { hasText: embedOrigin }),
    ).toBeVisible();

    await options
      .getByRole('button', {
        name: `Block ${embedOrigin} on site.test again`,
      })
      .click();

    await expect
      .poll(async () =>
        (await getDynamicRules(context)).some((rule) => rule.id === 3000),
      )
      .toBe(false);

    await page.reload({ waitUntil: 'load' });
    await expect(
      page.locator(`[data-scriptshredder-embed="${embedOrigin}"]`),
    ).toBeVisible();
  });

  test('sends GPC and can remove the third-party Referer header', async () => {
    await expect
      .poll(async () => Boolean(await getBlockRule(context)))
      .toBe(true);

    const page = await openSite(context);

    await resetImageHeaders();
    await page.reload({ waitUntil: 'load' });

    await expect
      .poll(async () => (await fetchImageHeaders()).image?.['sec-gpc'])
      .toBe('1');

    const before = await fetchImageHeaders();
    expect(before.image?.['referer']).toBeTruthy();
    expect(before.image?.['x-client-data']).toBeUndefined();

    const options = await openOptions(context);
    await options
      .getByRole('switch', { name: 'Remove third-party Referer' })
      .click();

    await expect
      .poll(async () =>
        (await getDynamicRules(context)).some((rule) => rule.id === 4000),
      )
      .toBe(true);

    await resetImageHeaders();
    await page.reload({ waitUntil: 'load' });

    await expect
      .poll(async () => (await fetchImageHeaders()).image)
      .not.toBeNull();

    const after = await fetchImageHeaders();
    expect(after.image?.['referer']).toBeUndefined();
  });
});
