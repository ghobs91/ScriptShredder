import { useMemo, useState } from 'react';
import {
  groupPageScripts,
  type PageScript,
  type ScriptHostGroup,
} from '../lib/pageScripts';

const MAX_VISIBLE_GROUPS = 15;
const MAX_VISIBLE_PATHS = 50;

type ScriptListProps = {
  scripts: PageScript[];
  loading: boolean;
  error: boolean;
  disabled: boolean;
  busy: boolean;
  note?: string;
  onToggle: (script: PageScript) => void;
  onToggleHost: (group: ScriptHostGroup) => void;
  onAllowEverywhere: (group: ScriptHostGroup) => void;
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
  onToggleHost,
  onAllowEverywhere,
  onRefresh,
  onReload,
}: ScriptListProps) {
  const groups = useMemo(() => groupPageScripts(scripts), [scripts]);
  const [showAllGroups, setShowAllGroups] = useState(false);
  const visibleGroups = showAllGroups
    ? groups
    : groups.slice(0, MAX_VISIBLE_GROUPS);
  const hiddenGroupCount = groups.length - visibleGroups.length;

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
      ) : groups.length === 0 ? (
        <p className="scripts-empty">
          No third-party scripts detected on this page.
        </p>
      ) : (
        <ul className="scripts-list">
          {visibleGroups.map((group) => {
            const groupBlocked = group.scripts.some((script) => script.blocked);

            return (
              <li className="script-group" key={group.origin}>
                <div className="script-group-header">
                  <div className="script-copy" title={group.origin}>
                    <span className="script-host">{group.host}</span>
                    {group.scripts.length === 1 ? (
                      <span className="script-path">
                        {group.scripts[0]?.path}
                      </span>
                    ) : (
                      <span className="script-path">
                        {group.scripts.length} scripts
                      </span>
                    )}
                  </div>

                  <div className="script-actions">
                    <span
                      className={`script-badge ${
                        groupBlocked ? 'is-blocked' : 'is-allowed'
                      }`}
                    >
                      {group.globalAllowed
                        ? 'All sites'
                        : groupBlocked
                          ? 'Blocked'
                          : 'Allowed'}
                    </span>
                    {disabled || group.globalAllowed ? null : (
                      <>
                        <button
                          type="button"
                          className="script-toggle"
                          onClick={() => onToggleHost(group)}
                          disabled={busy}
                          title={
                            group.allowed
                              ? `Block every script from ${group.host} on this site`
                              : `Allow every script from ${group.host} on this site`
                          }
                        >
                          {group.allowed ? 'Block all' : 'Allow all'}
                        </button>
                        <button
                          type="button"
                          className="script-toggle"
                          onClick={() => onAllowEverywhere(group)}
                          disabled={busy}
                          title={`Allow scripts and embeds from ${group.host} on every site`}
                        >
                          Everywhere
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {group.scripts.length > 1 ? (
                  <details
                    className="script-paths"
                    open={group.scripts.length <= 3}
                  >
                    <summary>Paths ({group.scripts.length})</summary>
                    <ul>
                      {group.scripts
                        .slice(0, MAX_VISIBLE_PATHS)
                        .map((script) => (
                          <li key={script.script}>
                            <span className="script-path" title={script.script}>
                              {script.path}
                            </span>

                            <div className="script-actions">
                              <span
                                className={`script-badge ${
                                  script.blocked ? 'is-blocked' : 'is-allowed'
                                }`}
                              >
                                {script.globalAllowed
                                  ? 'All sites'
                                  : script.blocked
                                    ? 'Blocked'
                                    : 'Allowed'}
                              </span>
                              {disabled ||
                              group.allowed ||
                              script.globalAllowed ? null : (
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
                      {group.scripts.length > MAX_VISIBLE_PATHS ? (
                        <li className="script-path">
                          …and {group.scripts.length - MAX_VISIBLE_PATHS} more
                        </li>
                      ) : null}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
          {hiddenGroupCount > 0 ? (
            <li className="script-group">
              <button
                type="button"
                className="scripts-refresh"
                onClick={() => setShowAllGroups(true)}
              >
                Show all {groups.length} hosts
              </button>
            </li>
          ) : null}
        </ul>
      )}

      {note ? <p className="scripts-note">{note}</p> : null}
    </section>
  );
}
