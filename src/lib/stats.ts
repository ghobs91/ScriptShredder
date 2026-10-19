import { browser } from 'wxt/browser';
import { normalizeScriptUrl } from './domain';

export const STATS_KEY = 'blockedStats';
export const MAX_TRACKED_SCRIPTS = 500;

export type BlockedScriptStat = {
  script: string;
  count: number;
  lastBlockedAt: number;
};

export type BlockedStats = {
  total: number;
  scripts: BlockedScriptStat[];
};

export const EMPTY_STATS: BlockedStats = {
  total: 0,
  scripts: [],
};

export function normalizeStats(value: unknown): BlockedStats {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { total: 0, scripts: [] };
  }

  const record = value as Record<string, unknown>;
  const total =
    typeof record.total === 'number' &&
    Number.isFinite(record.total) &&
    record.total >= 0
      ? Math.floor(record.total)
      : 0;

  const rawScripts = Array.isArray(record.scripts) ? record.scripts : [];
  const scripts = new Map<string, BlockedScriptStat>();

  for (const value of rawScripts) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

    const entry = value as Record<string, unknown>;
    if (
      typeof entry.script !== 'string' ||
      typeof entry.count !== 'number' ||
      !Number.isFinite(entry.count) ||
      typeof entry.lastBlockedAt !== 'number' ||
      !Number.isFinite(entry.lastBlockedAt)
    ) {
      continue;
    }

    const script = normalizeScriptUrl(entry.script);
    const count = Math.floor(entry.count);
    if (!script || count <= 0) continue;

    const existing = scripts.get(script);
    if (existing) {
      existing.count += count;
      existing.lastBlockedAt = Math.max(
        existing.lastBlockedAt,
        entry.lastBlockedAt,
      );
    } else {
      scripts.set(script, {
        script,
        count,
        lastBlockedAt: entry.lastBlockedAt,
      });
    }
  }

  return {
    total,
    scripts: [...scripts.values()]
      .sort((a, b) => b.count - a.count || a.script.localeCompare(b.script))
      .slice(0, MAX_TRACKED_SCRIPTS),
  };
}

export function incrementStats(
  stats: BlockedStats,
  scripts: readonly string[],
  at: number,
): BlockedStats {
  const unique = [
    ...new Set(
      scripts
        .map((script) => normalizeScriptUrl(script))
        .filter((script): script is string => script !== null),
    ),
  ];

  if (unique.length === 0) return normalizeStats(stats);

  const current = normalizeStats(stats);
  const tracked = new Map(
    current.scripts.map((entry) => [entry.script, entry]),
  );

  for (const script of unique) {
    const existing = tracked.get(script);
    if (existing) {
      existing.count += 1;
      existing.lastBlockedAt = at;
      continue;
    }

    if (tracked.size < MAX_TRACKED_SCRIPTS) {
      tracked.set(script, { script, count: 1, lastBlockedAt: at });
    }
  }

  return {
    total: current.total + unique.length,
    scripts: [...tracked.values()]
      .sort((a, b) => b.count - a.count || a.script.localeCompare(b.script))
      .slice(0, MAX_TRACKED_SCRIPTS),
  };
}

export async function getStats(): Promise<BlockedStats> {
  const stored = await browser.storage.local.get(STATS_KEY);
  return normalizeStats(stored[STATS_KEY]);
}

export async function recordBlockedScripts(
  scripts: readonly string[],
  at: number = Date.now(),
): Promise<void> {
  const current = await getStats();
  const next = incrementStats(current, scripts, at);
  await browser.storage.local.set({ [STATS_KEY]: next });
}

export async function resetStats(): Promise<void> {
  await browser.storage.local.set({ [STATS_KEY]: EMPTY_STATS });
}
