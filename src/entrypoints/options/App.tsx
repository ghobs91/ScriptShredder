import { useState, type FormEvent } from 'react';
import { browser } from 'wxt/browser';
import { ShieldIcon } from '../../components/icons';
import { Toggle } from '../../components/Toggle';
import { normalizeSiteInput } from '../../lib/domain';
import { requestRuleSync, requestStatsReset } from '../../lib/messaging';
import {
  MAX_PAUSED_SITES,
  updateSettings,
  type Settings,
} from '../../lib/settings';
import { formatCount, formatRelativeTime } from '../../lib/time';
import { useSettings } from '../../lib/useSettings';
import { useStats } from '../../lib/useStats';

type Message = {
  tone: 'error' | 'success';
  text: string;
};

export function App() {
  const [settings, setSettings] = useSettings();
  const stats = useStats();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  if (!settings) {
    return (
      <main className="page">
        <p className="note">Loading ScriptShredder…</p>
      </main>
    );
  }

  const version = browser.runtime.getManifest().version;
  const totalBlocks = stats?.total ?? 0;
  const topScripts = stats?.scripts.slice(0, 10) ?? [];

  const commit = async (
    change: (current: Settings) => Settings,
  ): Promise<Settings | null> => {
    setBusy(true);

    try {
      const next = await updateSettings(change);
      setSettings(next);
      await requestRuleSync();
      return next;
    } catch {
      setMessage({
        tone: 'error',
        text: 'Could not save that change. Try again.',
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toggleProtection = async () => {
    if (busy) return;
    setMessage(null);

    const next = await commit((current) => ({
      ...current,
      enabled: !current.enabled,
    }));

    if (next) {
      setMessage({
        tone: 'success',
        text: next.enabled
          ? 'Protection is on. Reload open tabs to apply it.'
          : 'Protection is off on every site.',
      });
    }
  };

  const addSite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !input.trim()) return;

    const site = normalizeSiteInput(input);

    if (!site) {
      setMessage({
        tone: 'error',
        text: 'Enter a domain like example.com or a full https:// URL.',
      });
      return;
    }

    if (settings.pausedSites.includes(site)) {
      setMessage({ tone: 'error', text: `${site} is already paused.` });
      return;
    }

    if (settings.pausedSites.length >= MAX_PAUSED_SITES) {
      setMessage({
        tone: 'error',
        text: `You can pause up to ${MAX_PAUSED_SITES} sites.`,
      });
      return;
    }

    const next = await commit((current) => ({
      ...current,
      pausedSites: [...current.pausedSites, site],
    }));

    if (next) {
      setInput('');
      setMessage({
        tone: 'success',
        text: `Paused on ${site}. Reload its open tabs to let third-party scripts through.`,
      });
    }
  };

  const removeSite = async (site: string) => {
    if (busy) return;
    setMessage(null);

    const next = await commit((current) => ({
      ...current,
      pausedSites: current.pausedSites.filter((value) => value !== site),
    }));

    if (next) {
      setMessage({ tone: 'success', text: `Blocking resumed on ${site}.` });
    }
  };

  const removeException = async (site: string, script: string) => {
    if (busy) return;
    setMessage(null);

    const next = await commit((current) => ({
      ...current,
      scriptExceptions: current.scriptExceptions.filter(
        (exception) =>
          !(exception.site === site && exception.script === script),
      ),
    }));

    if (next) {
      setMessage({
        tone: 'success',
        text: `Blocking resumed for ${script} on ${site}.`,
      });
    }
  };

  const clearSites = async () => {
    if (busy) return;

    const confirmed = window.confirm(
      'Remove every paused site? Blocking will resume everywhere.',
    );
    if (!confirmed) return;

    setMessage(null);
    const next = await commit((current) => ({
      ...current,
      pausedSites: [],
    }));

    if (next) {
      setMessage({ tone: 'success', text: 'Blocking resumed everywhere.' });
    }
  };

  const resetCounters = async () => {
    if (busy) return;

    const confirmed = window.confirm(
      'Reset all blocked-script counters? This cannot be undone.',
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage(null);

    try {
      await requestStatsReset();
      setMessage({ tone: 'success', text: 'Blocked-script counters reset.' });
    } catch {
      setMessage({
        tone: 'error',
        text: 'Could not reset the counters. Try again.',
      });
    } finally {
      setBusy(false);
    }
  };

  const pausedCount = settings.pausedSites.length;

  const exceptionGroups = new Map<string, string[]>();
  for (const exception of settings.scriptExceptions) {
    const scripts = exceptionGroups.get(exception.site) ?? [];
    scripts.push(exception.script);
    exceptionGroups.set(exception.site, scripts);
  }
  const groupedExceptions = [...exceptionGroups.entries()].sort(
    ([siteA], [siteB]) => siteA.localeCompare(siteB),
  );

  return (
    <main className="page">
      <header className="page-header">
        <div className="brand">
          <span className="brand-mark">
            <ShieldIcon />
          </span>
          <div>
            <h1>ScriptShredder</h1>
            <p>Settings</p>
          </div>
        </div>
        <span className="build-tag">Manifest V3 · local only</span>
      </header>

      <section className="intro">
        <p className="eyebrow">Third-party JavaScript blocker</p>
        <h2>Keep each site&apos;s code. Drop everyone else&apos;s.</h2>
        <p className="lede">
          ScriptShredder blocks script requests that come from a different site
          than the page making the request. First-party JavaScript keeps
          working, so sites stay functional without a blanket script ban.
        </p>
      </section>

      {message ? (
        <p
          className={`message is-${message.tone}`}
          role={message.tone === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}

      <section className="card">
        <div className="row">
          <div className="row-copy">
            <h3>Protection</h3>
            <p className="note">
              Blocks third-party script requests on every site that isn&apos;t
              paused below.
            </p>
          </div>
          <Toggle
            checked={settings.enabled}
            onChange={() => void toggleProtection()}
            disabled={busy}
            label={
              settings.enabled ? 'Turn protection off' : 'Turn protection on'
            }
          />
        </div>
        <p className="inline-status">
          <span
            className={`status-dot${settings.enabled ? '' : ' is-off'}`}
            aria-hidden="true"
          />
          {settings.enabled
            ? 'Active on all sites except paused ones'
            : 'Off everywhere'}
        </p>
      </section>

      <section className="card">
        <div className="row">
          <div className="row-copy">
            <h3>
              Paused sites
              <span className="count-badge">{pausedCount}</span>
            </h3>
            <p className="note">
              Paused sites may load third-party scripts. Use this when blocking
              breaks a site.
            </p>
          </div>
          {pausedCount > 0 ? (
            <button
              type="button"
              className="text-action"
              onClick={() => void clearSites()}
              disabled={busy}
            >
              Clear all
            </button>
          ) : null}
        </div>

        <form className="add-form" onSubmit={(event) => void addSite(event)}>
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="example.com"
            aria-label="Site to pause"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !input.trim()}>
            Pause site
          </button>
        </form>

        {pausedCount === 0 ? (
          <p className="empty">
            No paused sites. Third-party scripts are blocked everywhere.
          </p>
        ) : (
          <ul className="site-list">
            {settings.pausedSites.map((site) => (
              <li key={site}>
                <span className="mono site-name">{site}</span>
                <button
                  type="button"
                  className="remove"
                  onClick={() => void removeSite(site)}
                  disabled={busy}
                  aria-label={`Remove ${site} from paused sites`}
                  title={`Resume blocking on ${site}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="row">
          <div className="row-copy">
            <h3>
              Individual exceptions
              <span className="count-badge">
                {settings.scriptExceptions.length}
              </span>
            </h3>
            <p className="note">
              Specific third-party scripts allowed on a site. Pausing a whole
              site takes precedence.
            </p>
          </div>
        </div>

        {groupedExceptions.length === 0 ? (
          <p className="empty">
            No individual exceptions. Use the ScriptShredder popup on a site to
            allow a specific third-party script.
          </p>
        ) : (
          <div className="exception-groups">
            {groupedExceptions.map(([site, scripts]) => (
              <div className="exception-group" key={site}>
                <h4>{site}</h4>
                <ul>
                  {scripts.map((script) => (
                    <li key={script}>
                      <span className="exception-script" title={script}>
                        {script}
                      </span>
                      <button
                        type="button"
                        className="remove"
                        onClick={() => void removeException(site, script)}
                        disabled={busy}
                        aria-label={`Block ${script} on ${site} again`}
                        title={`Block ${script} on ${site} again`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="row">
          <div className="row-copy">
            <h3>
              Most blocked scripts
              <span className="count-badge">
                {formatCount(totalBlocks)}
              </span>
            </h3>
            <p className="note">
              Local counts of blocked third-party scripts across pages. Each
              script on a page load counts once.
            </p>
          </div>
          {totalBlocks > 0 ? (
            <button
              type="button"
              className="text-action"
              onClick={() => void resetCounters()}
              disabled={busy}
            >
              Reset
            </button>
          ) : null}
        </div>

        <div className="stats-total">
          <strong>{formatCount(totalBlocks)}</strong>
          <span>total block events recorded</span>
        </div>

        {topScripts.length === 0 ? (
          <p className="empty">
            Nothing counted yet. Browse a site and blocked third-party scripts
            will appear here.
          </p>
        ) : (
          <>
            <ol className="stats-list">
              {topScripts.map((stat, index) => (
                <li key={stat.script}>
                  <span className="stat-rank">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="stat-script" title={stat.script}>
                    {stat.script}
                  </span>
                  <span className="stat-meta">
                    <span className="stat-count">
                      {formatCount(stat.count)}×
                    </span>
                    <span className="stat-time">
                      {formatRelativeTime(stat.lastBlockedAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            {stats && stats.scripts.length > topScripts.length ? (
              <p className="stats-footnote">
                Showing the top {topScripts.length} of{' '}
                {formatCount(stats.scripts.length)} tracked scripts.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="card" id="how-it-works">
        <h3>How it works</h3>
        <ol className="steps">
          <li>
            <strong>Same-site scripts load normally.</strong> A script at{' '}
            <code>cdn.example.com</code> on <code>www.example.com</code> shares
            the same registrable domain, so it isn&apos;t third-party.
          </li>
          <li>
            <strong>Cross-site scripts are blocked.</strong> A script at{' '}
            <code>cdn.other.test</code> on <code>example.com</code> belongs to a
            different registrable domain and never reaches the page.
          </li>
          <li>
            <strong>Pause a site or allow one script.</strong> Paused domains and
            individual exceptions are stored locally and survive restarts.
            Reload open tabs after changing a setting so the new rules apply.
            The popup also lists the third-party scripts detected on the
            current page, with an Allow action for individual scripts.
          </li>
          <li>
            <strong>Counters are inferred locally.</strong> The page collector
            reports script URLs to the background, which checks them against
            the current settings before incrementing the most-blocked list.
            Nothing is uploaded.
          </li>
        </ol>
        <p className="note limitations">
          Only network script requests are blocked. Inline scripts,{' '}
          <code>eval</code>, and JavaScript downloaded as data and then executed
          are outside a network-level blocklist&apos;s reach. Dynamic imports
          and workers aren&apos;t represented as script elements, so they may be
          blocked without appearing in the page list or counters.
        </p>
      </section>

      <footer className="page-footer">
        <span>ScriptShredder v{version}</span>
        <span>No accounts. No telemetry. Settings stay on this device.</span>
      </footer>
    </main>
  );
}
