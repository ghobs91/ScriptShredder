import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { ShieldIcon } from '../../components/icons';
import { ScriptList } from '../../components/ScriptList';
import { Toggle } from '../../components/Toggle';
import { siteFromUrl } from '../../lib/domain';
import { getPageScripts, requestRuleSync } from '../../lib/messaging';
import {
  describePageScripts,
  type PageScript,
} from '../../lib/pageScripts';
import {
  hasScriptException,
  isSitePaused,
  updateSettings,
  type Settings,
} from '../../lib/settings';
import { useSettings } from '../../lib/useSettings';

export function App() {
  const [settings, setSettings] = useSettings();
  const [site, setSite] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState('');
  const [rawScripts, setRawScripts] = useState<string[] | null>(null);
  const [scanError, setScanError] = useState(false);
  const [scanNonce, setScanNonce] = useState(0);
  const [tabId, setTabId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (!active) return;
        setTabId(tab?.id ?? null);
        setSite(siteFromUrl(tab?.url));
      })
      .catch(() => {
        // The active tab may not be readable; the rest of the popup still works.
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (tabId === null) return;

    let active = true;
    setRawScripts(null);
    setScanError(false);

    getPageScripts(tabId)
      .then((response) => {
        if (!active) return;
        setPageUrl(response.pageUrl);
        setRawScripts(response.scripts);
        setSite((current) => current ?? siteFromUrl(response.pageUrl));
      })
      .catch(() => {
        if (!active) return;
        setScanError(true);
        setRawScripts([]);
      });

    return () => {
      active = false;
    };
  }, [tabId, scanNonce]);

  if (!settings) {
    return <div className="popup popup-loading">Loading ScriptShredder…</div>;
  }

  const effectiveSite = site ?? siteFromUrl(pageUrl);
  const paused = isSitePaused(settings, effectiveSite);
  const state = !settings.enabled
    ? 'off'
    : !effectiveSite
      ? 'idle'
      : paused
        ? 'paused'
        : 'active';

  const pageSource =
    pageUrl || (effectiveSite ? `https://${effectiveSite}/` : '');
  const pageScripts = describePageScripts(
    pageSource,
    rawScripts ?? [],
    settings,
  );
  const canManageScripts = settings.enabled && !paused;
  const scriptsLoading =
    tabId !== null && rawScripts === null && !scanError;

  const commit = async (change: (current: Settings) => Settings) => {
    setBusy(true);
    setError(null);

    try {
      const next = await updateSettings(change);
      setSettings(next);
      await requestRuleSync();

      if (tabId !== null) {
        try {
          await browser.tabs.reload(tabId);
        } catch {
          // The tab may have closed while the popup was open.
        }
      }
    } catch {
      setError('Could not apply that change. Try reopening the popup.');
    } finally {
      setBusy(false);
    }
  };

  const toggleProtection = () => {
    if (busy) return;
    void commit((current) => ({ ...current, enabled: !current.enabled }));
  };

  const toggleSite = () => {
    if (!effectiveSite || busy || !settings.enabled) return;

    void commit((current) => ({
      ...current,
      pausedSites: paused
        ? current.pausedSites.filter((value) => value !== effectiveSite)
        : [...current.pausedSites, effectiveSite],
    }));
  };

  const toggleScript = (script: PageScript) => {
    if (!effectiveSite || busy || !canManageScripts) return;

    const allowed = hasScriptException(
      settings,
      effectiveSite,
      script.script,
    );

    void commit((current) => ({
      ...current,
      scriptExceptions: allowed
        ? current.scriptExceptions.filter(
            (exception) =>
              !(
                exception.site === effectiveSite &&
                exception.script === script.script
              ),
          )
        : [
            ...current.scriptExceptions,
            { site: effectiveSite, script: script.script },
          ],
    }));
  };

  let title: string;
  let detail: string;

  if (!settings.enabled) {
    title = 'Protection is off';
    detail = 'Third-party scripts are loading normally everywhere.';
  } else if (!effectiveSite) {
    title = 'Nothing to block here';
    detail = 'Open a regular website to use ScriptShredder.';
  } else if (paused) {
    title = 'Paused on this site';
    detail = `${effectiveSite} can load third-party scripts.`;
  } else {
    title = 'Third-party scripts blocked';
    detail = `${effectiveSite} runs its own scripts. External scripts are blocked.`;
  }

  let scriptNote: string | undefined;
  if (!settings.enabled) {
    scriptNote = 'Protection is off, so these scripts are allowed.';
  } else if (paused) {
    scriptNote = 'This site is paused, so all of its scripts are allowed.';
  }

  const pausedCount = settings.pausedSites.length;

  return (
    <div className="popup">
      <header className="popup-header">
        <div className="brand">
          <span className="brand-mark">
            <ShieldIcon />
          </span>
          <div>
            <h1>ScriptShredder</h1>
            <p>Third-party JS blocker</p>
          </div>
        </div>

        <Toggle
          checked={settings.enabled}
          onChange={toggleProtection}
          disabled={busy}
          label={
            settings.enabled ? 'Turn protection off' : 'Turn protection on'
          }
        />
      </header>

      <main className="popup-main">
        <section className={`status-card is-${state}`} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <p className="status-title">{title}</p>
            <p className="status-detail">{detail}</p>
          </div>
        </section>

        <section className="site-card">
          <div className="site-copy">
            <span className="eyebrow">Current site</span>
            <span className="site-domain" title={effectiveSite ?? undefined}>
              {effectiveSite ?? 'Unavailable'}
            </span>
          </div>

          <button
            type="button"
            className={`site-action${paused ? ' is-paused' : ''}`}
            onClick={toggleSite}
            disabled={!effectiveSite || busy || !settings.enabled}
            title={
              settings.enabled
                ? undefined
                : 'Turn protection on to pause individual sites.'
            }
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
        </section>

        <ScriptList
          scripts={pageScripts}
          loading={scriptsLoading}
          error={scanError}
          disabled={!canManageScripts}
          busy={busy}
          note={scriptNote}
          onToggle={toggleScript}
          onRefresh={() => setScanNonce((value) => value + 1)}
          onReload={() => {
            if (tabId !== null) void browser.tabs.reload(tabId);
          }}
        />

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </main>

      <footer className="popup-footer">
        <a
          href={browser.runtime.getURL('/options.html')}
          target="_blank"
          rel="noreferrer"
        >
          Settings
        </a>
        <span>
          {pausedCount === 0
            ? 'No sites paused'
            : `${pausedCount} ${pausedCount === 1 ? 'site' : 'sites'} paused`}
        </span>
      </footer>
    </div>
  );
}
