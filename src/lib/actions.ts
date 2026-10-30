import { globalScriptExceptionCovers } from './globalScripts';
import { normalizeScriptUrl, scriptExceptionCovers } from './scriptUrl';
import type { HardeningSettings } from './settings';

export const PAGE_ACTION_KINDS = [
  'script',
  'iframe',
  'beacon',
  'headers',
  'gpc',
  'tracking',
] as const;

export type PageActionKind = (typeof PAGE_ACTION_KINDS)[number];

export type PageAction = {
  kind: PageActionKind;
  url: string;
  /** For tracking cleanups, the URL after removing parameters. */
  cleaned?: string;
  /**
   * Number of requests this action represents. Header and GPC actions are
   * aggregated per origin; everything else defaults to one.
   */
  count?: number;
};

export type PageActionInput = {
  pageUrl: string;
  site: string;
  enabled: boolean;
  paused: boolean;
  hardening: HardeningSettings;
  /** Script exceptions for this site. */
  scriptExceptions: readonly string[];
  /** Script and embed hosts allowed on every site. */
  globalScriptExceptions: readonly string[];
  /** Script URLs seen in the page's DOM. */
  scripts: readonly string[];
  /** Third-party iframe URLs replaced with a click-to-load placeholder. */
  frames: readonly string[];
  /** Ping/attribution URLs removed from DOM attributes. */
  beacons: readonly string[];
  /** Network requests observed with Resource Timing. */
  resources: readonly string[];
  /** URLs whose tracking parameters were stripped. */
  cleanups: ReadonlyArray<{ from: string; to: string }>;
};

export type PageActionGroup = {
  kind: PageActionKind;
  /** Number of requests, including repeats to the same URL or origin. */
  count: number;
  /** Number of distinct scripts, embeds, URLs, or origins in this group. */
  distinct: number;
  items: Array<{ url: string; cleaned?: string; count: number }>;
};

/**
 * Aggregated per-page activity. `total` counts distinct things (the number the
 * toolbar badge shows); `requests` counts raw requests, which is generally much
 * larger on heavy pages.
 */
export type PageActivity = {
  total: number;
  requests: number;
  groups: PageActionGroup[];
};

export const EMPTY_ACTIVITY: PageActivity = {
  total: 0,
  requests: 0,
  groups: [],
};

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}

export function isThirdPartyUrl(value: string, site: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  return host !== site && !host.endsWith(`.${site}`);
}

function isBlockedScript(
  script: string,
  site: string,
  exceptions: readonly string[],
  globalExceptions: readonly string[],
): boolean {
  return (
    isThirdPartyUrl(script, site) &&
    !exceptions.some((exception) => scriptExceptionCovers(exception, script)) &&
    !globalExceptions.some((exception) =>
      globalScriptExceptionCovers(exception, script),
    )
  );
}

/**
 * Builds the observable action log for a page. This is the single source of
 * truth for both the toolbar badge and the popup breakdown, so the number and
 * the list always agree.
 */
export function buildPageActions(input: PageActionInput): PageAction[] {
  if (!input.enabled || input.paused) return [];

  const actions: PageAction[] = [];
  const blockedScripts = new Set<string>();

  for (const script of new Set(input.scripts)) {
    if (
      isBlockedScript(
        script,
        input.site,
        input.scriptExceptions,
        input.globalScriptExceptions,
      )
    ) {
      blockedScripts.add(script);
      actions.push({ kind: 'script', url: script });
    }
  }

  const blockedFrameUrls = new Set<string>();
  for (const frame of new Set(input.frames)) {
    const normalized = normalizeScriptUrl(frame);
    if (normalized) blockedFrameUrls.add(normalized);
    actions.push({ kind: 'iframe', url: frame });
  }

  for (const beacon of new Set(input.beacons)) {
    actions.push({ kind: 'beacon', url: beacon });
  }

  const isBlockedRequest = (url: string): boolean =>
    blockedScripts.has(url) || blockedFrameUrls.has(url);

  if (
    input.hardening.reduceFingerprintHeaders ||
    input.hardening.removeThirdPartyReferer
  ) {
    // One action per third-party origin, so a page with hundreds of requests
    // to the same CDN stays one line and one counted item.
    const origins = new Map<string, number>();
    for (const resource of input.resources) {
      if (isBlockedRequest(resource)) continue;
      if (!isThirdPartyUrl(resource, input.site)) continue;

      const origin = originOf(resource);
      if (!origin) continue;
      origins.set(origin, (origins.get(origin) ?? 0) + 1);
    }

    for (const [url, count] of origins) {
      actions.push({ kind: 'headers', url, count });
    }
  }

  if (input.hardening.sendGpc) {
    actions.push({ kind: 'gpc', url: input.pageUrl });

    const origins = new Map<string, number>();
    for (const resource of input.resources) {
      if (isBlockedRequest(resource)) continue;
      if (!isThirdPartyUrl(resource, input.site)) continue;

      const origin = originOf(resource);
      if (!origin) continue;
      origins.set(origin, (origins.get(origin) ?? 0) + 1);
    }

    for (const [url, count] of origins) {
      actions.push({ kind: 'gpc', url, count });
    }
  }

  if (input.hardening.stripTrackingParams) {
    const seen = new Set<string>();
    for (const cleanup of input.cleanups) {
      const key = `${cleanup.from}\n${cleanup.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      actions.push({
        kind: 'tracking',
        url: cleanup.from,
        cleaned: cleanup.to,
      });
    }
  }

  return actions;
}

/** Groups actions for display while keeping the total request count. */
export function groupPageActions(
  actions: readonly PageAction[],
): PageActionGroup[] {
  const grouped = new Map<
    PageActionKind,
    Map<string, PageActionGroup['items'][number]>
  >();

  for (const action of actions) {
    const items = grouped.get(action.kind) ?? new Map();
    const key = action.cleaned
      ? `${action.url}\n${action.cleaned}`
      : action.url;
    const existing = items.get(key);
    const count = action.count ?? 1;

    if (existing) {
      existing.count += count;
    } else {
      items.set(key, {
        url: action.url,
        ...(action.cleaned ? { cleaned: action.cleaned } : {}),
        count,
      });
    }

    grouped.set(action.kind, items);
  }

  return PAGE_ACTION_KINDS.flatMap((kind): PageActionGroup[] => {
    const items = grouped.get(kind);
    if (!items || items.size === 0) return [];

    const sorted = [...items.values()].sort(
      (a, b) => b.count - a.count || a.url.localeCompare(b.url),
    );

    return [
      {
        kind,
        count: sorted.reduce((total, item) => total + item.count, 0),
        distinct: sorted.length,
        items: sorted,
      },
    ];
  });
}

/**
 * Collapses actions into per-kind groups and two totals: distinct items for the
 * badge, raw requests for the detail view.
 */
export function summarizePageActions(
  actions: readonly PageAction[],
): PageActivity {
  const groups = groupPageActions(actions);

  return {
    total: groups.reduce((sum, group) => sum + group.distinct, 0),
    requests: groups.reduce((sum, group) => sum + group.count, 0),
    groups,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isPageAction(value: unknown): value is PageAction {
  if (!isRecord(value) || Array.isArray(value)) return false;

  return (
    typeof value.kind === 'string' &&
    (PAGE_ACTION_KINDS as readonly string[]).includes(value.kind) &&
    typeof value.url === 'string' &&
    (value.cleaned === undefined || typeof value.cleaned === 'string') &&
    (value.count === undefined ||
      (typeof value.count === 'number' && Number.isFinite(value.count)))
  );
}

function isPageActionItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    typeof value.count === 'number' &&
    Number.isFinite(value.count) &&
    (value.cleaned === undefined || typeof value.cleaned === 'string')
  );
}

function isPageActionGroup(value: unknown): value is PageActionGroup {
  return (
    isRecord(value) &&
    typeof value.kind === 'string' &&
    (PAGE_ACTION_KINDS as readonly string[]).includes(value.kind) &&
    typeof value.count === 'number' &&
    Number.isFinite(value.count) &&
    typeof value.distinct === 'number' &&
    Number.isFinite(value.distinct) &&
    Array.isArray(value.items) &&
    value.items.every(isPageActionItem)
  );
}

export function isPageActivity(value: unknown): value is PageActivity {
  return (
    isRecord(value) &&
    typeof value.total === 'number' &&
    Number.isFinite(value.total) &&
    typeof value.requests === 'number' &&
    Number.isFinite(value.requests) &&
    Array.isArray(value.groups) &&
    value.groups.every(isPageActionGroup)
  );
}
