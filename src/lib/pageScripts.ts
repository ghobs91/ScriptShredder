import { normalizeScriptUrl, siteFromUrl } from './domain';
import {
  hasGlobalScriptException,
  hasScriptException,
  isSitePaused,
  type Settings,
} from './settings';

export type PageScript = {
  /** Normalized URL used for matching and display. */
  script: string;
  host: string;
  path: string;
  /** Origin URL used for host-wide exceptions, e.g. https://cdn.test/ */
  origin: string;
  blocked: boolean;
  /** True when the whole origin is allowed for this site. */
  originAllowed: boolean;
  /** True when a global exception allows this script on every site. */
  globalAllowed: boolean;
};

export type ScriptHostGroup = {
  origin: string;
  host: string;
  scripts: PageScript[];
  /** True when an origin-wide exception covers every script in the group. */
  allowed: boolean;
  /** True when every script in the group is allowed on every site. */
  globalAllowed: boolean;
};

/**
 * Returns unique third-party script URLs for a page. The page's registrable
 * domain is the reference point; subdomains count as first-party.
 */
export function listThirdPartyScripts(
  pageUrl: string,
  rawScripts: readonly string[],
): string[] {
  const pageSite = siteFromUrl(pageUrl);
  if (!pageSite) return [];

  const scripts = new Set<string>();

  for (const raw of rawScripts) {
    const script = normalizeScriptUrl(raw);
    if (!script) continue;

    const scriptSite = siteFromUrl(raw);
    if (!scriptSite || scriptSite === pageSite) continue;

    scripts.add(script);
  }

  return [...scripts].sort();
}

export function isScriptBlocked(
  settings: Settings,
  pageSite: string,
  script: string,
): boolean {
  if (!settings.enabled || isSitePaused(settings, pageSite)) return false;
  return (
    !hasScriptException(settings, pageSite, script) &&
    !hasGlobalScriptException(settings, script)
  );
}

export function describePageScripts(
  pageUrl: string,
  rawScripts: readonly string[],
  settings: Settings,
): PageScript[] {
  const pageSite = siteFromUrl(pageUrl);
  if (!pageSite) return [];

  return listThirdPartyScripts(pageUrl, rawScripts)
    .map((script): PageScript => {
      const url = new URL(script);
      const origin = `${url.origin}/`;
      return {
        script,
        host: url.host,
        path: url.pathname || '/',
        origin,
        blocked: isScriptBlocked(settings, pageSite, script),
        originAllowed: hasScriptException(settings, pageSite, origin),
        globalAllowed: hasGlobalScriptException(settings, script),
      };
    })
    .sort(
      (a, b) =>
        Number(b.blocked) - Number(a.blocked) ||
        a.host.localeCompare(b.host) ||
        a.path.localeCompare(b.path),
    );
}

/**
 * Groups page scripts by origin so the popup can offer one Allow action per
 * third-party host instead of one per asset. Hosts with no origin-wide
 * exception come first, then hosts are sorted alphabetically.
 */
export function groupPageScripts(
  scripts: readonly PageScript[],
): ScriptHostGroup[] {
  const groups = new Map<string, ScriptHostGroup>();

  for (const script of scripts) {
    const group = groups.get(script.origin) ?? {
      origin: script.origin,
      host: script.host,
      scripts: [],
      allowed: false,
      globalAllowed: true,
    };

    group.scripts.push(script);
    group.allowed = group.allowed || script.originAllowed;
    group.globalAllowed = group.globalAllowed && script.globalAllowed;
    groups.set(script.origin, group);
  }

  return [...groups.values()].sort(
    (a, b) =>
      Number(a.allowed || a.globalAllowed) -
        Number(b.allowed || b.globalAllowed) ||
      a.host.localeCompare(b.host) ||
      a.origin.localeCompare(b.origin),
  );
}

export function collectBlockedScripts(
  pageUrl: string,
  rawScripts: readonly string[],
  settings: Settings,
): string[] {
  return describePageScripts(pageUrl, rawScripts, settings)
    .filter((script) => script.blocked)
    .map((script) => script.script);
}
