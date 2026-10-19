import { normalizeScriptUrl, siteFromUrl } from './domain';
import {
  hasScriptException,
  isSitePaused,
  type Settings,
} from './settings';

export type PageScript = {
  /** Normalized URL used for matching and display. */
  script: string;
  host: string;
  path: string;
  blocked: boolean;
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
  return !hasScriptException(settings, pageSite, script);
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
      return {
        script,
        host: url.host,
        path: url.pathname || '/',
        blocked: isScriptBlocked(settings, pageSite, script),
      };
    })
    .sort(
      (a, b) =>
        Number(b.blocked) - Number(a.blocked) ||
        a.host.localeCompare(b.host) ||
        a.path.localeCompare(b.path),
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
