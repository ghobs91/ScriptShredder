import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  isRecordBlockedScriptsMessage,
  isResetStatsMessage,
  isSyncRulesMessage,
} from '../lib/messaging';
import { collectBlockedScripts } from '../lib/pageScripts';
import { buildDynamicRules } from '../lib/rules';
import { getSettings, SETTINGS_KEY } from '../lib/settings';
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

    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((rule) => rule.id),
      addRules: buildDynamicRules(settings),
    });
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

  async function enableActionCount(): Promise<void> {
    const dnr = browser.declarativeNetRequest as unknown as {
      setExtensionActionOptions?: (options: {
        displayActionCountAsBadgeText: boolean;
      }) => Promise<void>;
    };

    if (typeof dnr.setExtensionActionOptions !== 'function') return;

    try {
      await dnr.setExtensionActionOptions({
        displayActionCountAsBadgeText: true,
      });
    } catch {
      // Optional browser feature. Firefox and Safari don't implement it.
    }
  }

  function reportError(error: unknown): void {
    console.error('[ScriptShredder] background task failed', error);
  }

  browser.runtime.onInstalled.addListener(() => {
    void syncRules().then(enableActionCount).catch(reportError);
  });

  browser.runtime.onStartup.addListener(() => {
    void syncRules().then(enableActionCount).catch(reportError);
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    void syncRules().catch(reportError);
  });

  // Reconcile on every background start. Dynamic rules normally survive, but
  // this recovers from extension updates, manual storage edits, and browser
  // states where the ruleset was cleared.
  void syncRules().catch(reportError);

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isSyncRulesMessage(message)) {
      syncRules()
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

    return false;
  });
});
