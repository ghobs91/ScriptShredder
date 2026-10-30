import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { summarizePageActions, type PageAction } from '../lib/actions';
import { ActionList } from './ActionList';

function render(actions: PageAction[]) {
  return renderToStaticMarkup(
    <ActionList
      activity={summarizePageActions(actions)}
      loading={false}
      error={false}
    />,
  );
}

const actions: PageAction[] = [
  { kind: 'script', url: 'https://cdn.other.test/blocked.js' },
  { kind: 'iframe', url: 'https://widget.test/embed.html' },
  { kind: 'beacon', url: 'https://cdn.other.test/ping' },
  {
    kind: 'headers',
    url: 'https://cdn.other.test/loaded.js',
  },
  { kind: 'gpc', url: 'https://cdn.other.test/loaded.js' },
  { kind: 'gpc', url: 'https://cdn.other.test/loaded.js' },
  {
    kind: 'tracking',
    url: 'https://site.test/?utm_source=a',
    cleaned: 'https://site.test/',
  },
];

describe('ActionList', () => {
  it('shows distinct items in the header and request totals per row', () => {
    const html = render(actions);

    expect(html).toContain('Blocked &amp; modified');
    expect(html).toContain('>6<');
    expect(html).toContain('2 requests');
    expect(html).toContain('Blocked scripts');
    expect(html).toContain('Blocked embeds');
    expect(html).toContain('Ping &amp; attribution removed');
    expect(html).toContain('Privacy headers reduced');
    expect(html).toContain('Sec-GPC sent');
    expect(html).toContain('Tracking parameters stripped');
    expect(html).toContain('see list above');
  });

  it('shows request URLs and repeat counts for other actions', () => {
    const html = render(actions);

    expect(html).toContain('https://widget.test/embed.html');
    expect(html).toContain('https://cdn.other.test/ping');
    expect(html).toContain('×2');
    expect(html).toContain('https://site.test/?utm_source=a');
    expect(html).toContain('→ https://site.test/');
  });

  it('explains observability limits and the empty state', () => {
    const empty = render([]);

    expect(empty).toContain('No blocked or modified requests observed');
    expect(empty).toContain('sendBeacon, CSP reports, dynamic imports');
  });
});
