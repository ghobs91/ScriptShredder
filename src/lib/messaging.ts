import { browser } from 'wxt/browser';

export const SYNC_RULES_MESSAGE = 'scriptshredder:sync-rules' as const;
export const GET_PAGE_SCRIPTS_MESSAGE = 'scriptshredder:get-page-scripts' as const;
export const RECORD_BLOCKED_SCRIPTS_MESSAGE =
  'scriptshredder:record-blocked-scripts' as const;
export const RESET_STATS_MESSAGE = 'scriptshredder:reset-stats' as const;

export type SyncRulesMessage = {
  type: typeof SYNC_RULES_MESSAGE;
};

export type GetPageScriptsMessage = {
  type: typeof GET_PAGE_SCRIPTS_MESSAGE;
};

export type RecordBlockedScriptsMessage = {
  type: typeof RECORD_BLOCKED_SCRIPTS_MESSAGE;
  pageUrl: string;
  scripts: string[];
};

export type ResetStatsMessage = {
  type: typeof RESET_STATS_MESSAGE;
};

export type PageScriptsResponse = {
  pageUrl: string;
  scripts: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isSyncRulesMessage(value: unknown): value is SyncRulesMessage {
  return isRecord(value) && value.type === SYNC_RULES_MESSAGE;
}

export function isGetPageScriptsMessage(
  value: unknown,
): value is GetPageScriptsMessage {
  return isRecord(value) && value.type === GET_PAGE_SCRIPTS_MESSAGE;
}

export function isResetStatsMessage(value: unknown): value is ResetStatsMessage {
  return isRecord(value) && value.type === RESET_STATS_MESSAGE;
}

export function isRecordBlockedScriptsMessage(
  value: unknown,
): value is RecordBlockedScriptsMessage {
  return (
    isRecord(value) &&
    value.type === RECORD_BLOCKED_SCRIPTS_MESSAGE &&
    typeof value.pageUrl === 'string' &&
    Array.isArray(value.scripts) &&
    value.scripts.every((script) => typeof script === 'string')
  );
}

/**
 * Asks the background service worker to reconcile dynamic rules with storage.
 * The popup awaits this before reloading the tab so the new rules are in place.
 */
export async function requestRuleSync(): Promise<void> {
  const response = (await browser.runtime.sendMessage({
    type: SYNC_RULES_MESSAGE,
  } satisfies SyncRulesMessage)) as { ok?: boolean; error?: string } | undefined;

  if (response?.ok === false) {
    throw new Error(response.error ?? 'Rule sync failed');
  }
}

export async function getPageScripts(
  tabId: number,
): Promise<PageScriptsResponse> {
  const response = (await browser.tabs.sendMessage(tabId, {
    type: GET_PAGE_SCRIPTS_MESSAGE,
  } satisfies GetPageScriptsMessage)) as unknown;

  if (!isRecord(response)) return { pageUrl: '', scripts: [] };

  return {
    pageUrl:
      typeof response.pageUrl === 'string' ? response.pageUrl : '',
    scripts: Array.isArray(response.scripts)
      ? response.scripts.filter(
          (script): script is string => typeof script === 'string',
        )
      : [],
  };
}

/**
 * Content-script side: reports script URLs seen on a page. The background
 * decides whether each one was actually blocked before counting it.
 */
export async function recordPageScripts(
  pageUrl: string,
  scripts: string[],
): Promise<void> {
  if (scripts.length === 0) return;

  await browser.runtime.sendMessage({
    type: RECORD_BLOCKED_SCRIPTS_MESSAGE,
    pageUrl,
    scripts,
  } satisfies RecordBlockedScriptsMessage);
}

export async function requestStatsReset(): Promise<void> {
  const response = (await browser.runtime.sendMessage({
    type: RESET_STATS_MESSAGE,
  } satisfies ResetStatsMessage)) as
    | { ok?: boolean; error?: string }
    | undefined;

  if (response?.ok === false) {
    throw new Error(response.error ?? 'Stats reset failed');
  }
}
