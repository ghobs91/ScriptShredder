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

async function getStats(context: BrowserContext): Promise<BlockedStats | null> {
  const worker = await getWorker(context);
  return worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('blockedStats');
    return (stored.blockedStats as BlockedStats | undefined) ?? null;
  });
}

async function getPageScripts(
  context: BrowserContext,
): Promise<{ pageUrl: string; scripts: string[] } | null> {
  const worker = await getWorker(context);
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) return null;

    return (await chrome.tabs.sendMessage(tab.id, {
      type: 'scriptshredder:get-page-scripts',
    })) as { pageUrl: string; scripts: string[] };
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

async function openSite(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('http://site.test:4173/', { waitUntil: 'load' });
  return page;
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
        '--host-resolver-rules=MAP site.test 127.0.0.1, MAP api.site.test 127.0.0.1, MAP cdn.test 127.0.0.1',
      ],
    });
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('blocks third-party scripts but allows first-party and same-site scripts', async () => {
    await expect
      .poll(async () => (await getDynamicRules(context)).length)
      .toBe(1);

    const page = await openSite(context);
    const flags = await readFlags(page);

    expect(flags.firstPartyLoaded).toBe(true);
    expect(flags.sameSiteLoaded).toBe(true);
    expect(flags.thirdPartyLoaded).toBeUndefined();
  });

  test('lists page scripts and records local blocked-script counters', async () => {
    await expect
      .poll(async () => (await getDynamicRules(context)).length)
      .toBe(1);

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
      .poll(async () => (await getDynamicRules(context)).length)
      .toBe(1);

    const options = await openOptions(context);
    const response = await options.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'scriptshredder:sync-rules' }),
    );

    expect(response).toEqual({ ok: true });
  });

  test('pausing a site through settings allows its third-party scripts', async () => {
    await expect
      .poll(async () => (await getDynamicRules(context)).length)
      .toBe(1);

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
  });

  test('turning protection off allows all scripts', async () => {
    await expect
      .poll(async () => (await getDynamicRules(context)).length)
      .toBe(1);

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
      .poll(async () => (await getDynamicRules(context)).length)
      .toBe(1);

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
          (rule) => rule.action.type === 'allow',
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
          (rule) => rule.action.type === 'allow',
        ),
      )
      .toBe(false);

    page = await openSite(context);
    flags = await readFlags(page);

    expect(flags.thirdPartyLoaded).toBeUndefined();
  });

  test('removing a paused site blocks it again', async () => {
    await expect
      .poll(async () => (await getDynamicRules(context)).length)
      .toBe(1);

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
});
