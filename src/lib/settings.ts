import { browser } from 'wxt/browser';
import {
  normalizeScriptUrl,
  normalizeSiteInput,
  siteFromHostname,
} from './domain';

export const SETTINGS_KEY = 'settings';
export const MAX_PAUSED_SITES = 500;
export const MAX_SCRIPT_EXCEPTIONS = 500;

export type ScriptException = {
  /** Registrable domain where the exception applies. */
  site: string;
  /** Normalized script URL (origin + pathname, no query or fragment). */
  script: string;
};

export type Settings = {
  enabled: boolean;
  pausedSites: string[];
  scriptExceptions: ScriptException[];
};

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  pausedSites: [],
  scriptExceptions: [],
};

export function normalizeSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      enabled: DEFAULT_SETTINGS.enabled,
      pausedSites: [],
      scriptExceptions: [],
    };
  }

  const record = value as Record<string, unknown>;
  const enabled =
    typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SETTINGS.enabled;
  const rawSites = Array.isArray(record.pausedSites) ? record.pausedSites : [];

  const sites = rawSites.flatMap((value): string[] => {
    if (typeof value !== 'string') return [];
    const site = siteFromHostname(value) ?? normalizeSiteInput(value);
    return site ? [site] : [];
  });

  const rawExceptions = Array.isArray(record.scriptExceptions)
    ? record.scriptExceptions
    : [];

  const exceptions = rawExceptions.flatMap((value): ScriptException[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

    const entry = value as Record<string, unknown>;
    if (typeof entry.site !== 'string' || typeof entry.script !== 'string') {
      return [];
    }

    const site =
      siteFromHostname(entry.site) ?? normalizeSiteInput(entry.site);
    const script = normalizeScriptUrl(entry.script);
    return site && script ? [{ site, script }] : [];
  });

  const uniqueExceptions = [
    ...new Map(
      exceptions.map((exception) => [
        `${exception.site}\n${exception.script}`,
        exception,
      ]),
    ).values(),
  ].sort(
    (a, b) =>
      a.site.localeCompare(b.site) || a.script.localeCompare(b.script),
  );

  return {
    enabled,
    pausedSites: [...new Set(sites)].sort().slice(0, MAX_PAUSED_SITES),
    scriptExceptions: uniqueExceptions.slice(0, MAX_SCRIPT_EXCEPTIONS),
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const next = normalizeSettings(settings);
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function updateSettings(
  updater: (current: Settings) => Settings,
): Promise<Settings> {
  return saveSettings(updater(await getSettings()));
}

export function isSitePaused(settings: Settings, site: string | null): boolean {
  return site !== null && settings.pausedSites.includes(site);
}

export function hasScriptException(
  settings: Settings,
  site: string,
  script: string,
): boolean {
  return settings.scriptExceptions.some(
    (exception) => exception.site === site && exception.script === script,
  );
}
