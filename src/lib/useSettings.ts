import { useEffect, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import {
  getSettings,
  normalizeSettings,
  SETTINGS_KEY,
  type Settings,
} from './settings';

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let active = true;

    getSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch(() => {
        if (active) setSettings(normalizeSettings(undefined));
      });

    const onChanged = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      const change = changes[SETTINGS_KEY];
      if (!change) return;
      setSettings(normalizeSettings(change.newValue));
    };

    browser.storage.onChanged.addListener(onChanged);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return [settings, setSettings] as const;
}
