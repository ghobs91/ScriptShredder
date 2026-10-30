import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  normalizeFrameOrigin,
  normalizeSiteInput,
  siteFromHostname,
  siteFromUrl,
} from '../lib/domain';
import {
  isAllowIframeMessage,
  isGetPageContextMessage,
  isRecordBlockedScriptsMessage,
  isResetStatsMessage,
  isSyncBadgeMessage,
  isSyncRulesMessage,
  type PageContext,
} from '../lib/messaging';
import { collectBlockedScripts } from '../lib/pageScripts';
import { buildDynamicRules } from '../lib/rules';
import {
  getSettings,
  isSitePaused,
  SETTINGS_KEY,
  updateSettings,
} from '../lib/settings';
import { recordBlockedScripts, resetStats } from '../lib/stats';

export default defineBackground(() => {
  let rulesQueue: Promise<void> = Promise.resolve();
  let statsQueue: Promise<void> = Promise.resolve();

  function syncRules(): Promise<void> {
    rulesQueue = rulesQueue.then(reconcileRules, reconcileRules);
    return rulesQueue;
  }

  async function reconcileRules(): Promise<void> {
    const settings = await getSettings();
    const existing = await browser.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map((rule) => rule.id);
    const attempts: Array<{
      includeHeaderRules: boolean;
      includeNavigationRedirects: boolean;
    }> = [
      { includeHeaderRules: true, includeNavigationRedirects: true },
      { includeHeaderRules: true, includeNavigationRedirects: false },
      { includeHeaderRules: false, includeNavigationRedirects: true },
      { includeHeaderRules: false, includeNavigationRedirects: false },
    ];

    let lastError: unknown;

    for (const [index, options] of attempts.entries()) {
      try {
        await browser.declarativeNetRequest.updateDynamicRules({
          removeRuleIds,
          addRules: buildDynamicRules(settings, options),
        });

        if (index > 0) {
          console.warn(
            '[ScriptShredder] some hardening rules are unsupported; using reduced rule set',
            lastError,
          );
        }
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error('Could not update declarativeNetRequest rules');
  }

  function queueStats(operation: () => Promise<void>): Promise<void> {
    statsQueue = statsQueue.then(operation, operation);
    return statsQueue;
  }

  async function handleRecordedScripts(
    pageUrl: string,
    scripts: string[],
  ): Promise<void> {
    const settings = await getSettings();
    const blocked = collectBlockedScripts(pageUrl, scripts, settings);
    if (blocked.length === 0) return;

    await queueStats(() => recordBlockedScripts(blocked));
  }

  async function handleResetStats(): Promise<void> {
    await queueStats(resetStats);
  }

  async function handlePageContext(pageUrl: string): Promise<PageContext> {
    const settings = await getSettings();
    const site = siteFromUrl(pageUrl);

    return {
      site,
      enabled: settings.enabled,
      paused: isSitePaused(settings, site),
      hardening: settings.hardening,
      iframeExceptions: site
        ? settings.iframeExceptions
            .filter((exception) => exception.site === site)
            .map((exception) => exception.frame)
        : [],
      scriptExceptions: site
        ? settings.scriptExceptions
            .filter((exception) => exception.site === site)
            .map((exception) => exception.script)
        : [],
      globalScriptExceptions: settings.globalScriptExceptions,
    };
  }

  async function handleAllowIframe(
    rawSite: string,
    rawFrame: string,
  ): Promise<void> {
    const site =
      siteFromHostname(rawSite) ?? normalizeSiteInput(rawSite);
    const frame = normalizeFrameOrigin(rawFrame);

    if (!site || !frame) {
      throw new Error('Invalid embed exception');
    }

    const next = await updateSettings((current) => {
      if (
        current.iframeExceptions.some(
          (exception) =>
            exception.site === site && exception.frame === frame,
        )
      ) {
        return current;
      }

      return {
        ...current,
        iframeExceptions: [
          ...current.iframeExceptions,
          { site, frame },
        ],
      };
    });

    if (
      !next.iframeExceptions.some(
        (exception) =>
          exception.site === site && exception.frame === frame,
      )
    ) {
      throw new Error('Embed exception limit reached');
    }

    await syncRules();
  }

  function badgeText(count: number): string {
    const value = Math.floor(count);
    if (value <= 0) return '';
    return value > 999 ? '999+' : String(value);
  }

  async function setTabBadge(tabId: number, count: number): Promise<void> {
    if (typeof browser.action?.setBadgeText !== 'function') return;

    await browser.action.setBadgeText({
      tabId,
      text: badgeText(count),
    });
  }

  async function configureBadge(): Promise<void> {
    // Older builds used the browser's DNR action count, which also counts
    // header-editing rules. Disable it so the script-action badge wins.
    const dnr = browser.declarativeNetRequest as unknown as {
      setExtensionActionOptions?: (options: {
        displayActionCountAsBadgeText: boolean;
      }) => Promise<void>;
    };

    try {
      await dnr.setExtensionActionOptions?.({
        displayActionCountAsBadgeText: false,
      });
    } catch {
      // Optional browser feature. Firefox and Safari don't implement it.
    }

    try {
      await browser.action?.setBadgeBackgroundColor?.({ color: '#11160f' });
    } catch {
      // Badge colors are optional in some browsers.
    }
  }

  function reportError(error: unknown): void {
    console.error('[ScriptShredder] background task failed', error);
  }

  browser.runtime.onInstalled.addListener(() => {
    void configureBadge().catch(reportError);
    void syncRules().catch(reportError);
  });

  browser.runtime.onStartup.addListener(() => {
    void configureBadge().catch(reportError);
    void syncRules().catch(reportError);
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    void syncRules().catch(reportError);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      void setTabBadge(tabId, 0).catch(reportError);
    }
  });

  // Reconcile on every background start. Dynamic rules normally survive, but
  // this recovers from extension updates, manual storage edits, and browser
  // states where the ruleset was cleared.
  void configureBadge().catch(reportError);
  void syncRules().catch(reportError);

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isSyncRulesMessage(message)) {
      syncRules()
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => {
          reportError(error);
          sendResponse({ ok: false, error: String(error) });
        });

      return true;
    }

    if (isGetPageContextMessage(message)) {
      handlePageContext(message.pageUrl)
        .then((context) => sendResponse({ ok: true, context }))
        .catch((error: unknown) => {
          reportError(error);
          sendResponse({ ok: false, error: String(error) });
        });

      return true;
    }

    if (isAllowIframeMessage(message)) {
      handleAllowIframe(message.site, message.frame)
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => {
          reportError(error);
          sendResponse({ ok: false, error: String(error) });
        });

      return true;
    }

    if (isRecordBlockedScriptsMessage(message)) {
      handleRecordedScripts(message.pageUrl, message.scripts)
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => {
          reportError(error);
          sendResponse({ ok: false, error: String(error) });
        });

      return true;
    }

    if (isResetStatsMessage(message)) {
      handleResetStats()
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => {
          reportError(error);
          sendResponse({ ok: false, error: String(error) });
        });

      return true;
    }

    if (isSyncBadgeMessage(message)) {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        void setTabBadge(tabId, message.count).catch(reportError);
      }
      sendResponse({ ok: true });

      return false;
    }

    return false;
  });
});
