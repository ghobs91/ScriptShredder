import { useEffect, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import {
  getStats,
  normalizeStats,
  STATS_KEY,
  type BlockedStats,
} from './stats';

export function useStats(): BlockedStats | null {
  const [stats, setStats] = useState<BlockedStats | null>(null);

  useEffect(() => {
    let active = true;

    getStats()
      .then((value) => {
        if (active) setStats(value);
      })
      .catch(() => {
        if (active) setStats(normalizeStats(undefined));
      });

    const onChanged = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      const change = changes[STATS_KEY];
      if (!change) return;
      setStats(normalizeStats(change.newValue));
    };

    browser.storage.onChanged.addListener(onChanged);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return stats;
}
