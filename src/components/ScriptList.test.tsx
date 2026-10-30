import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { describePageScripts, type PageScript } from '../lib/pageScripts';
import { DEFAULT_HARDENING, type Settings } from '../lib/settings';
import { ScriptList } from './ScriptList';

const pageUrl = 'https://github.com/';
const rawScripts = [
  'https://github.githubassets.com/assets/a.js',
  'https://github.githubassets.com/assets/b.js',
  'https://cdn.other.test/tracker.js',
];

function settings(patch: Partial<Settings> = {}): Settings {
  return {
    enabled: true,
    pausedSites: [],
    scriptExceptions: [],
    iframeExceptions: [],
    globalScriptExceptions: [],
    hardening: { ...DEFAULT_HARDENING },
    ...patch,
  };
}

function renderScripts(scripts: PageScript[]) {
  return renderToStaticMarkup(
    <ScriptList
      scripts={scripts}
      loading={false}
      error={false}
      disabled={false}
      busy={false}
      onToggle={() => {}}
      onToggleHost={() => {}}
      onAllowEverywhere={() => {}}
      onRefresh={() => {}}
      onReload={() => {}}
    />,
  );
}

function render(value: Settings) {
  return renderScripts(describePageScripts(pageUrl, rawScripts, value));
}

describe('ScriptList', () => {
  it('groups scripts by host behind one Allow all action', () => {
    const html = render(settings());

    expect(html).toContain('github.githubassets.com');
    expect(html).toContain('2 scripts');
    expect(html.match(/Allow all/g)).toHaveLength(2);
    expect(html.match(/Everywhere/g)).toHaveLength(2);
    expect(html).toContain('Paths (2)');
    expect(html).not.toContain('Block all');
  });

  it('marks globally allowed hosts and hides per-site actions', () => {
    const html = render(
      settings({
        globalScriptExceptions: ['https://github.githubassets.com/'],
      }),
    );

    expect(html).toContain('All sites');
    // Only the non-global cdn.other.test group keeps per-site actions.
    expect(html.match(/Everywhere/g)).toHaveLength(1);
    expect(html.match(/Allow all/g)).toHaveLength(1);
  });

  it('offers Block all and hides per-path controls for an allowed host', () => {
    const html = render(
      settings({
        scriptExceptions: [
          {
            site: 'github.com',
            script: 'https://github.githubassets.com/',
          },
        ],
      }),
    );

    expect(html.match(/Block all/g)).toHaveLength(1);
    expect(html.match(/>Allow all</g)).toHaveLength(1);
    expect(html.match(/>Allow</g)).toBeNull();
  });
});
