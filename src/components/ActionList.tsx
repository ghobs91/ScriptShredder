import type { PageActionKind, PageActivity } from '../lib/actions';

const ACTION_LABELS: Record<PageActionKind, string> = {
  script: 'Blocked scripts',
  iframe: 'Blocked embeds',
  beacon: 'Ping & attribution removed',
  headers: 'Privacy headers reduced',
  gpc: 'Sec-GPC sent',
  tracking: 'Tracking parameters stripped',
};

const MAX_VISIBLE_ITEMS = 20;

type ActionListProps = {
  activity: PageActivity;
  loading: boolean;
  error: boolean;
};

export function ActionList({ activity, loading, error }: ActionListProps) {
  const { groups } = activity;

  return (
    <section className="scripts-card actions-card">
      <div className="scripts-header">
        <div className="scripts-heading">
          <span className="eyebrow">Blocked &amp; modified</span>
          {!loading && !error ? (
            <span
              className="scripts-count"
              title="Distinct items. The toolbar badge shows the same total, capped at 999+."
            >
              {activity.total}
            </span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="scripts-empty">Scanning this page…</p>
      ) : error ? (
        <p className="scripts-empty">
          Couldn&apos;t read this page&apos;s activity.
        </p>
      ) : groups.length === 0 ? (
        <p className="scripts-empty">
          No blocked or modified requests observed on this page.
        </p>
      ) : (
        <ul className="action-groups">
          {groups.map((group) => (
            <li key={group.kind}>
              {group.kind === 'script' ? (
                <div className="action-summary">
                  <span className="action-label">
                    {ACTION_LABELS[group.kind]}
                    <span className="action-hint">see list above</span>
                  </span>
                  <span className="action-count">{group.distinct}</span>
                </div>
              ) : (
                <details>
                  <summary className="action-summary">
                    <span className="action-label">
                      {ACTION_LABELS[group.kind]}
                    </span>
                    <span className="action-meta">
                      <span className="action-count">{group.distinct}</span>
                      {group.count > group.distinct ? (
                        <span className="action-detail">
                          {group.count} requests
                        </span>
                      ) : null}
                      <span className="action-chevron" aria-hidden="true" />
                    </span>
                  </summary>

                  <ul className="action-items">
                    {group.items
                      .slice(0, MAX_VISIBLE_ITEMS)
                      .map((item) => (
                        <li key={`${item.url}\n${item.cleaned ?? ''}`}>
                          <span className="action-url" title={item.url}>
                            {item.url}
                          </span>
                          {item.cleaned ? (
                            <span
                              className="action-url"
                              title={item.cleaned}
                            >
                              → {item.cleaned}
                            </span>
                          ) : null}
                          {item.count > 1 ? (
                            <span className="action-count">
                              ×{item.count}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    {group.items.length > MAX_VISIBLE_ITEMS ? (
                      <li>
                        …and {group.items.length - MAX_VISIBLE_ITEMS} more
                      </li>
                    ) : null}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="scripts-note">
        Counts add up distinct items: blocked scripts and embeds, plus
        third-party origins whose headers were changed. Request totals appear
        next to each row. Only actions visible to the page are listed;
        sendBeacon, CSP reports, dynamic imports, and worker requests
        aren&apos;t observable.
      </p>
    </section>
  );
}
