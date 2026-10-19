import { browser } from 'wxt/browser';
import {
  normalizeFrameOrigin,
  normalizeScriptUrl,
  normalizeSiteInput,
  siteFromHostname,
} from './domain';

export const SETTINGS_KEY = 'settings';
export const MAX_PAUSED_SITES = 500;
export const MAX_SCRIPT_EXCEPTIONS = 500;
export const MAX_IFRAME_EXCEPTIONS = 300;

export type ScriptException = {
  /** Registrable domain where the exception applies. */
  site: string;
  /** Normalized script URL (origin + pathname, no query or fragment). */
  script: string;
};

export type IframeException = {
  /** Registrable domain where the exception applies. */
  site: string;
  /** Third-party iframe origin, for example https://www.youtube.com */
  frame: string;
};

export type HardeningSettings = {
  /** Block third-party ping/CSP report requests and DOM ping attributes. */
  blockBeacons: boolean;
  /** Strip known tracking parameters from navigations and link clicks. */
  stripTrackingParams: boolean;
  /** Remove the Referer header on third-party requests. */
  removeThirdPartyReferer: boolean;
  /** Remove third-party dns-prefetch/preconnect/prefetch/prerender links. */
  removeSpeculationLinks: boolean;
  /** Remove third-party Client Hints and X-Client-Data. */
  reduceFingerprintHeaders: boolean;
  /** Send Sec-GPC: 1 on requests. */
  sendGpc: boolean;
  /** Replace third-party iframes with a click-to-load placeholder. */
  clickToLoadIframes: boolean;
};

export const DEFAULT_HARDENING: HardeningSettings = {
  blockBeacons: true,
  stripTrackingParams: true,
  removeThirdPartyReferer: false,
  removeSpeculationLinks: true,
  reduceFingerprintHeaders: true,
  sendGpc: true,
  clickToLoadIframes: true,
};

export type Settings = {
  enabled: boolean;
  pausedSites: string[];
  scriptExceptions: ScriptException[];
  iframeExceptions: IframeException[];
  hardening: HardeningSettings;
};

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  pausedSites: [],
  scriptExceptions: [],
  iframeExceptions: [],
  hardening: DEFAULT_HARDENING,
};

export function normalizeHardening(value: unknown): HardeningSettings {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const next: HardeningSettings = { ...DEFAULT_HARDENING };
  for (const key of Object.keys(DEFAULT_HARDENING) as Array<
    keyof HardeningSettings
  >) {
    if (typeof record[key] === 'boolean') {
      next[key] = record[key] as boolean;
    }
  }
  return next;
}

export function normalizeSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      enabled: DEFAULT_SETTINGS.enabled,
      pausedSites: [],
      scriptExceptions: [],
      iframeExceptions: [],
      hardening: normalizeHardening(undefined),
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

  const rawFrames = Array.isArray(record.iframeExceptions)
    ? record.iframeExceptions
    : [];

  const frames = rawFrames.flatMap((value): IframeException[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

    const entry = value as Record<string, unknown>;
    if (typeof entry.site !== 'string' || typeof entry.frame !== 'string') {
      return [];
    }

    const site =
      siteFromHostname(entry.site) ?? normalizeSiteInput(entry.site);
    const frame = normalizeFrameOrigin(entry.frame);
    return site && frame ? [{ site, frame }] : [];
  });

  const uniqueFrames = [
    ...new Map(
      frames.map((exception) => [
        `${exception.site}\n${exception.frame}`,
        exception,
      ]),
    ).values(),
  ]
    .sort(
      (a, b) =>
        a.site.localeCompare(b.site) || a.frame.localeCompare(b.frame),
    )
    .slice(0, MAX_IFRAME_EXCEPTIONS);

  return {
    enabled,
    pausedSites: [...new Set(sites)].sort().slice(0, MAX_PAUSED_SITES),
    scriptExceptions: uniqueExceptions.slice(0, MAX_SCRIPT_EXCEPTIONS),
    iframeExceptions: uniqueFrames,
    hardening: normalizeHardening(record.hardening),
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

export function hasIframeException(
  settings: Settings,
  site: string,
  frame: string,
): boolean {
  return settings.iframeExceptions.some(
    (exception) => exception.site === site && exception.frame === frame,
  );
}
