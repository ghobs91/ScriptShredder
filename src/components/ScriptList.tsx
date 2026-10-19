import type { PageScript } from '../lib/pageScripts';

type ScriptListProps = {
  scripts: PageScript[];
  loading: boolean;
  error: boolean;
  disabled: boolean;
  busy: boolean;
  note?: string;
  onToggle: (script: PageScript) => void;
  onRefresh: () => void;
  onReload: () => void;
};

export function ScriptList({
  scripts,
  loading,
  error,
  disabled,
  busy,
  note,
  onToggle,
  onRefresh,
  onReload,
}: ScriptListProps) {
  return (
    <section className="scripts-card">
      <div className="scripts-header">
        <div className="scripts-heading">
          <span className="eyebrow">Third-party scripts</span>
          {!loading && !error ? (
            <span className="scripts-count">{scripts.length}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="scripts-refresh"
          onClick={onRefresh}
          disabled={busy}
          title="Scan this page again"
        >
          Rescan
        </button>
      </div>

      {loading ? (
        <p className="scripts-empty">Scanning this page…</p>
      ) : error ? (
        <div className="scripts-empty">
          <p>Couldn&apos;t read this page&apos;s scripts.</p>
          <div className="scripts-error-actions">
            <button type="button" className="scripts-retry" onClick={onRefresh}>
              Try again
            </button>
            <button type="button" className="scripts-retry" onClick={onReload}>
              Reload page
            </button>
          </div>
        </div>
      ) : scripts.length === 0 ? (
        <p className="scripts-empty">
          No third-party scripts detected on this page.
        </p>
      ) : (
        <ul className="scripts-list">
          {scripts.map((script) => (
            <li key={script.script}>
              <div className="script-copy" title={script.script}>
                <span className="script-host">{script.host}</span>
                <span className="script-path">{script.path}</span>
              </div>

              <div className="script-actions">
                <span
                  className={`script-badge ${
                    script.blocked ? 'is-blocked' : 'is-allowed'
                  }`}
                >
                  {script.blocked ? 'Blocked' : 'Allowed'}
                </span>
                {disabled ? null : (
                  <button
                    type="button"
                    className="script-toggle"
                    onClick={() => onToggle(script)}
                    disabled={busy}
                  >
                    {script.blocked ? 'Allow' : 'Block'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {note ? <p className="scripts-note">{note}</p> : null}
    </section>
  );
}
