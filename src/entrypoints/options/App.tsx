import { useState, type FormEvent } from 'react';
import { browser } from 'wxt/browser';
import { ShieldIcon } from '../../components/icons';
import { Toggle } from '../../components/Toggle';
import { isOriginScriptUrl, normalizeSiteInput } from '../../lib/domain';
import {
  DEFAULT_GLOBAL_SCRIPT_EXCEPTIONS,
  globalScriptExceptionCovers,
  MAX_GLOBAL_SCRIPT_EXCEPTIONS,
  normalizeGlobalScriptInput,
} from '../../lib/globalScripts';
import { requestRuleSync, requestStatsReset } from '../../lib/messaging';
import {
  MAX_PAUSED_SITES,
  updateSettings,
  type HardeningSettings,
  type Settings,
} from '../../lib/settings';
import { formatCount, formatRelativeTime } from '../../lib/time';
import { useSettings } from '../../lib/useSettings';
import { useStats } from '../../lib/useStats';

type Message = {
  tone: 'error' | 'success';
  text: string;
};

/**
 * Origin exceptions are stored as https://host/ and cover every path, so show
 * them as https://host/* to distinguish them from a root-level script.
 */
function formatScriptException(script: string): string {
  return isOriginScriptUrl(script) ? `${script.slice(0, -1)}/*` : script;
}

/**
 * Global entries use a trailing slash for "this host and every path", so show
 * them as https://host/* for clarity.
 */
function formatGlobalException(host: string): string {
  return host.endsWith('/') ? `${host.slice(0, -1)}/*` : host;
}

export function App() {
  const [settings, setSettings] = useSettings();
  const stats = useStats();
  const [input, setInput] = useState('');
  const [globalInput, setGlobalInput] = useState('');
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

  const toggleHardening = async (key: keyof HardeningSettings) => {
    if (busy) return;
    setMessage(null);

    const next = await commit((current) => ({
      ...current,
      hardening: {
        ...current.hardening,
        [key]: !current.hardening[key],
      },
    }));

    if (next) {
      setMessage({
        tone: 'success',
        text: 'Hardening updated. Reload open tabs to apply it to existing requests.',
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
        text: `Blocking resumed for ${formatScriptException(script)} on ${site}.`,
      });
    }
  };

  const addGlobalHost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !globalInput.trim()) return;

    const host = normalizeGlobalScriptInput(globalInput);

    if (!host) {
      setMessage({
        tone: 'error',
        text: 'Enter a host like cdn.example.com or a full https:// URL.',
      });
      return;
    }

    if (settings.globalScriptExceptions.includes(host)) {
      setMessage({
        tone: 'error',
        text: `${formatGlobalException(host)} is already allowed everywhere.`,
      });
      return;
    }

    if (
      settings.globalScriptExceptions.length >= MAX_GLOBAL_SCRIPT_EXCEPTIONS
    ) {
      setMessage({
        tone: 'error',
        text: `You can allow up to ${MAX_GLOBAL_SCRIPT_EXCEPTIONS} hosts everywhere.`,
      });
      return;
    }

    const next = await commit((current) => ({
      ...current,
      // Per-site exceptions for this host are now redundant.
      scriptExceptions: current.scriptExceptions.filter(
        (exception) => !globalScriptExceptionCovers(host, exception.script),
      ),
      globalScriptExceptions: [...current.globalScriptExceptions, host],
    }));

    if (next) {
      setGlobalInput('');
      setMessage({
        tone: 'success',
        text: `Allowing ${formatGlobalException(host)} on every site. Reload open tabs to apply it.`,
      });
    }
  };

  const removeGlobalHost = async (host: string) => {
    if (busy) return;
    setMessage(null);

    const next = await commit((current) => ({
      ...current,
      globalScriptExceptions: current.globalScriptExceptions.filter(
        (value) => value !== host,
      ),
    }));

    if (next) {
      setMessage({
        tone: 'success',
        text: `Blocking ${formatGlobalException(host)} everywhere again.`,
      });
    }
  };

  const restoreDefaultGlobalHosts = async () => {
    if (busy) return;
    setMessage(null);

    const next = await commit((current) => ({
      ...current,
      globalScriptExceptions: [
        ...new Set([
          ...current.globalScriptExceptions,
          ...DEFAULT_GLOBAL_SCRIPT_EXCEPTIONS,
        ]),
      ],
    }));

    if (next) {
      setMessage({
        tone: 'success',
        text: 'Recommended content and captcha hosts are allowed everywhere again.',
      });
    }
  };

  const removeIframeException = async (site: string, frame: string) => {
    if (busy) return;
    setMessage(null);

    const next = await commit((current) => ({
      ...current,
      iframeExceptions: current.iframeExceptions.filter(
        (exception) =>
          !(exception.site === site && exception.frame === frame),
      ),
    }));

    if (next) {
      setMessage({
        tone: 'success',
        text: `Embeds from ${frame} are blocked again on ${site}.`,
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
  const missingDefaultGlobals = DEFAULT_GLOBAL_SCRIPT_EXCEPTIONS.filter(
    (host) => !settings.globalScriptExceptions.includes(host),
  );

  const exceptionGroups = new Map<string, string[]>();
  for (const exception of settings.scriptExceptions) {
    const scripts = exceptionGroups.get(exception.site) ?? [];
    scripts.push(exception.script);
    exceptionGroups.set(exception.site, scripts);
  }
  const groupedExceptions = [...exceptionGroups.entries()].sort(
    ([siteA], [siteB]) => siteA.localeCompare(siteB),
  );

  const iframeGroups = new Map<string, string[]>();
  for (const exception of settings.iframeExceptions) {
    const frames = iframeGroups.get(exception.site) ?? [];
    frames.push(exception.frame);
    iframeGroups.set(exception.site, frames);
  }
  const groupedIframes = [...iframeGroups.entries()].sort(
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
          than the page making the request, with optional hardening for
          beacons, tracking parameters, embeds, and fingerprinting headers.
          First-party JavaScript keeps working, so sites stay functional without
          a blanket script ban.
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
              Blocks third-party script requests and the optional hardening
              channels below on every site that isn&apos;t paused.
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
            <h3>Balanced hardening</h3>
            <p className="note">
              Extra privacy protections beyond script blocking. Header and
              URL-parameter changes apply to new requests; reload open tabs to
              update existing ones.
            </p>
          </div>
        </div>

        <div className="hardening-list">
          <HardeningRow
            title="Block third-party beacons and reports"
            description="Blocks sendBeacon, hyperlink auditing, and CSP/NEL reports sent to another site."
            checked={settings.hardening.blockBeacons}
            disabled={busy}
            onChange={() => void toggleHardening('blockBeacons')}
          />
          <HardeningRow
            title="Strip tracking parameters"
            description="Removes fbclid, gclid, utm_*, and similar parameters from navigations and link clicks."
            checked={settings.hardening.stripTrackingParams}
            disabled={busy}
            onChange={() => void toggleHardening('stripTrackingParams')}
          />
          <HardeningRow
            title="Remove third-party Referer"
            description="Hides the referring page from cross-site requests. This can break hotlink protection and some payment or CSRF flows."
            checked={settings.hardening.removeThirdPartyReferer}
            disabled={busy}
            onChange={() => void toggleHardening('removeThirdPartyReferer')}
          />
          <HardeningRow
            title="Remove speculative connections"
            description="Drops third-party dns-prefetch, preconnect, prefetch, and prerender links. Best effort, because the browser may act before the page script runs."
            checked={settings.hardening.removeSpeculationLinks}
            disabled={busy}
            onChange={() => void toggleHardening('removeSpeculationLinks')}
          />
          <HardeningRow
            title="Reduce fingerprinting headers"
            description="Removes third-party Client Hints and Chrome's X-Client-Data header."
            checked={settings.hardening.reduceFingerprintHeaders}
            disabled={busy}
            onChange={() => void toggleHardening('reduceFingerprintHeaders')}
          />
          <HardeningRow
            title="Send Global Privacy Control"
            description="Adds Sec-GPC: 1 to requests as a machine-readable opt-out signal."
            checked={settings.hardening.sendGpc}
            disabled={busy}
            onChange={() => void toggleHardening('sendGpc')}
          />
          <HardeningRow
            title="Click-to-load third-party embeds"
            description="Replaces third-party iframes with a Load placeholder. Allowed embeds are remembered per site."
            checked={settings.hardening.clickToLoadIframes}
            disabled={busy}
            onChange={() => void toggleHardening('clickToLoadIframes')}
          />
        </div>
      </section>

      <section className="card">
        <div className="row">
          <div className="row-copy">
            <h3>
              Paused sites
              <span className="count-badge">{pausedCount}</span>
            </h3>
            <p className="note">
              Paused sites may load third-party scripts and embeds. Use this
              when blocking breaks a site.
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
              Script exceptions
              <span className="count-badge">
                {settings.scriptExceptions.length}
              </span>
            </h3>
            <p className="note">
              Specific third-party scripts or whole hosts allowed on a site.
              Pausing a whole site takes precedence.
            </p>
          </div>
        </div>

        {groupedExceptions.length === 0 ? (
          <p className="empty">
            No script exceptions. Use the ScriptShredder popup on a site to
            allow a third-party script or host.
          </p>
        ) : (
          <div className="exception-groups">
            {groupedExceptions.map(([site, scripts]) => (
              <div className="exception-group" key={site}>
                <h4>{site}</h4>
                <ul>
                  {scripts.map((script) => {
                    const label = formatScriptException(script);

                    return (
                      <li key={script}>
                        <span className="exception-script" title={label}>
                          {label}
                        </span>
                        <button
                          type="button"
                          className="remove"
                          onClick={() => void removeException(site, script)}
                          disabled={busy}
                          aria-label={`Block ${label} on ${site} again`}
                          title={`Block ${label} on ${site} again`}
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
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
              Always-allowed hosts
              <span className="count-badge">
                {settings.globalScriptExceptions.length}
              </span>
            </h3>
            <p className="note">
              Scripts and embeds from these hosts load on every site. The
              recommended defaults cover common content CDNs, captcha
              providers, and hosted site builders. Remove any you don&apos;t
              want, or add your own.
            </p>
          </div>
          {missingDefaultGlobals.length > 0 ? (
            <button
              type="button"
              className="text-action"
              onClick={() => void restoreDefaultGlobalHosts()}
              disabled={busy}
            >
              Restore defaults
            </button>
          ) : null}
        </div>

        <form
          className="add-form"
          onSubmit={(event) => void addGlobalHost(event)}
        >
          <input
            type="text"
            value={globalInput}
            onChange={(event) => setGlobalInput(event.target.value)}
            placeholder="cdn.example.com"
            aria-label="Host to allow everywhere"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !globalInput.trim()}>
            Allow everywhere
          </button>
        </form>

        {settings.globalScriptExceptions.length === 0 ? (
          <p className="empty">
            No hosts allowed everywhere. Third-party scripts and embeds are
            blocked on every site.
          </p>
        ) : (
          <ul className="site-list">
            {settings.globalScriptExceptions.map((host) => (
              <li key={host}>
                <span className="mono site-name" title={host}>
                  {formatGlobalException(host)}
                </span>
                <button
                  type="button"
                  className="remove"
                  onClick={() => void removeGlobalHost(host)}
                  disabled={busy}
                  aria-label={`Stop allowing ${formatGlobalException(host)} everywhere`}
                  title={`Block ${formatGlobalException(host)} everywhere again`}
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
              Allowed embeds
              <span className="count-badge">
                {settings.iframeExceptions.length}
              </span>
            </h3>
            <p className="note">
              Third-party iframes you loaded on a site. Remove one to block it
              again. Click-to-load can be turned off in Balanced hardening.
            </p>
          </div>
        </div>

        {groupedIframes.length === 0 ? (
          <p className="empty">
            No embeds allowed. Use Load on a blocked third-party embed.
          </p>
        ) : (
          <div className="exception-groups">
            {groupedIframes.map(([site, frames]) => (
              <div className="exception-group" key={site}>
                <h4>{site}</h4>
                <ul>
                  {frames.map((frame) => (
                    <li key={frame}>
                      <span className="exception-script" title={frame}>
                        {frame}
                      </span>
                      <button
                        type="button"
                        className="remove"
                        onClick={() =>
                          void removeIframeException(site, frame)
                        }
                        disabled={busy}
                        aria-label={`Block ${frame} on ${site} again`}
                        title={`Block ${frame} on ${site} again`}
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
            The popup groups detected third-party scripts by host, so one
            Allow all action covers every asset from that host on the current
            site, while individual paths can still be allowed separately.
          </li>
          <li>
            <strong>Trusted content hosts work everywhere.</strong> The
            always-allowed list covers content CDNs, captcha providers, and
            hosted site builders. Those hosts load on every site, including
            their embeds, so captchas and common libraries keep working. Use
            Everywhere in the popup to add a host, or manage the list above.
          </li>
          <li>
            <strong>Hardening closes other channels.</strong> Third-party
            beacons, tracking parameters, speculative connections,
            fingerprinting headers, and third-party embeds are handled by the
            Balanced hardening options. Header support and speculative-link
            removal vary by browser and are best effort.
          </li>
          <li>
            <strong>Counters are inferred locally.</strong> The page collector
            reports script URLs to the background, which checks them against
            the current settings before incrementing the most-blocked list.
            Nothing is uploaded.
          </li>
        </ol>
        <p className="note limitations">
          Only network script requests are counted. Inline scripts,{' '}
          <code>eval</code>, and JavaScript downloaded as data and then executed
          are outside a network-level blocklist&apos;s reach. Dynamic imports
          and workers aren&apos;t represented as script elements, so they may be
          blocked without appearing in the page list or counters. The toolbar
          badge counts the blocked and modified actions listed in the popup:
          blocked scripts and embeds, removed ping/attribution attributes,
          third-party requests with privacy headers reduced, requests sent
          Sec-GPC, and tracking-parameter cleanups. It only covers what the page can
          observe; sendBeacon, CSP reports, dynamic imports, and worker
          requests are not counted. Click-to-load covers iframes in the top
          frame; headers and tracking-parameter cleanup depend on the
          browser&apos;s declarativeNetRequest support.
        </p>
      </section>

      <footer className="page-footer">
        <span>ScriptShredder v{version}</span>
        <span>No accounts. No telemetry. Settings stay on this device.</span>
      </footer>
    </main>
  );
}

type HardeningRowProps = {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
};

function HardeningRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: HardeningRowProps) {
  return (
    <div className="hardening-row">
      <div className="hardening-copy">
        <span className="hardening-title">{title}</span>
        <p className="note">{description}</p>
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        label={title}
      />
    </div>
  );
}
