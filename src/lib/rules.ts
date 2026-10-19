import type { Browser } from 'wxt/browser';
import type { Settings } from './settings';
import { TRACKING_PARAM_NAMES } from './tracking';

export const BLOCK_RULE_ID = 1;
export const ALLOW_RULE_ID_BASE = 1000;
export const ALLOW_SCRIPT_RULE_ID_BASE = 2000;
export const ALLOW_IFRAME_RULE_ID_BASE = 3000;

export const REFERER_RULE_ID = 4000;
export const FINGERPRINT_HEADERS_RULE_ID = 4001;
export const X_CLIENT_DATA_RULE_ID = 4002;
export const GPC_RULE_ID = 4003;
export const TRACKING_PARAM_RULE_ID_BASE = 5000;
export const TRACKING_PARAM_CHUNK_SIZE = 8;

const SUBRESOURCE_TYPES: `${Browser.declarativeNetRequest.ResourceType}`[] = [
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'other',
];

const ALL_TYPES: `${Browser.declarativeNetRequest.ResourceType}`[] = [
  'main_frame',
  ...SUBRESOURCE_TYPES,
];

const CLIENT_HINT_HEADERS = [
  'Sec-CH-UA',
  'Sec-CH-UA-Mobile',
  'Sec-CH-UA-Platform',
  'Sec-CH-UA-Platform-Version',
  'Sec-CH-UA-Arch',
  'Sec-CH-UA-Bitness',
  'Sec-CH-UA-Model',
  'Sec-CH-UA-Full-Version-List',
  'Sec-CH-UA-WoW64',
  'Device-Memory',
  'DPR',
  'Width',
  'Viewport-Width',
  'Downlink',
  'ECT',
  'RTT',
  'Save-Data',
];

type RuleBuildOptions = {
  includeHeaderRules?: boolean;
  includeNavigationRedirects?: boolean;
};

const TRACKING_PARAM_FILTER_PARTS = TRACKING_PARAM_NAMES.map(escapeRegex);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The extension uses these rule shapes:
 *
 * 1. Block third-party script requests, optional beacon/report requests, and
 *    optional third-party subframes (for click-to-load embeds).
 * 2. For paused sites, allow every request in the top-level frame hierarchy.
 * 3. For explicit exceptions, allow one script URL or one iframe origin when
 *    a specific site initiates it.
 * 4. For header hardening, remove Referer/Client Hints and set Sec-GPC.
 *
 * Priorities: block 1, paused site 2, explicit exception 3. Header rules use
 * priority 1 so a paused site's allowAllRequests rule suppresses them.
 */
export function buildDynamicRules(
  settings: Settings,
  options: RuleBuildOptions = {},
): Browser.declarativeNetRequest.Rule[] {
  if (!settings.enabled) return [];

  const blockedTypes: `${Browser.declarativeNetRequest.ResourceType}`[] = [
    'script',
  ];
  if (settings.hardening.blockBeacons) {
    blockedTypes.push('ping', 'csp_report');
  }
  if (settings.hardening.clickToLoadIframes) {
    blockedTypes.push('sub_frame');
  }

  const rules: Browser.declarativeNetRequest.Rule[] = [
    {
      id: BLOCK_RULE_ID,
      priority: 1,
      action: { type: 'block' },
      condition: {
        domainType: 'thirdParty',
        resourceTypes: blockedTypes,
      },
    },
  ];

  const sites = [...new Set(settings.pausedSites)].sort();
  for (const [index, site] of sites.entries()) {
    rules.push({
      id: ALLOW_RULE_ID_BASE + index,
      priority: 2,
      action: { type: 'allowAllRequests' },
      condition: {
        // Domain anchor + separator matches the bare domain, subdomains, and
        // any port, but not lookalikes such as example.com.evil.test.
        urlFilter: `||${site}^`,
        resourceTypes: ['main_frame'],
      },
    });
  }

  const exceptions = [...settings.scriptExceptions].sort(
    (a, b) =>
      a.site.localeCompare(b.site) || a.script.localeCompare(b.script),
  );
  for (const [index, exception] of exceptions.entries()) {
    rules.push({
      id: ALLOW_SCRIPT_RULE_ID_BASE + index,
      priority: 3,
      action: { type: 'allow' },
      condition: {
        // Anchor at the URL start. A query string or fragment on the actual
        // request still matches because this is a prefix filter.
        urlFilter: `|${exception.script}`,
        initiatorDomains: [exception.site],
        resourceTypes: ['script'],
      },
    });
  }

  const frameExceptions = [...settings.iframeExceptions].sort(
    (a, b) =>
      a.site.localeCompare(b.site) || a.frame.localeCompare(b.frame),
  );
  for (const [index, exception] of frameExceptions.entries()) {
    rules.push({
      id: ALLOW_IFRAME_RULE_ID_BASE + index,
      priority: 3,
      action: { type: 'allow' },
      condition: {
        urlFilter: `|${exception.frame}/`,
        initiatorDomains: [exception.site],
        resourceTypes: ['sub_frame'],
      },
    });
  }

  if (
    settings.hardening.stripTrackingParams &&
    options.includeNavigationRedirects !== false
  ) {
    for (
      let start = 0, index = 0;
      start < TRACKING_PARAM_FILTER_PARTS.length;
      start += TRACKING_PARAM_CHUNK_SIZE, index += 1
    ) {
      const names = TRACKING_PARAM_FILTER_PARTS.slice(
        start,
        start + TRACKING_PARAM_CHUNK_SIZE,
      );

      rules.push({
        id: TRACKING_PARAM_RULE_ID_BASE + index,
        priority: 4,
        action: {
          type: 'redirect',
          redirect: {
            transform: {
              queryTransform: {
                removeParams: [...TRACKING_PARAM_NAMES],
              },
            },
          },
        },
        condition: {
          regexFilter: `[?&](?:${names.join('|')})=`,
          isUrlFilterCaseSensitive: true,
          resourceTypes: ['main_frame', 'sub_frame'],
          requestMethods: ['get'],
        },
      });
    }
  }

  if (options.includeHeaderRules !== false) {
    if (settings.hardening.removeThirdPartyReferer) {
      rules.push({
        id: REFERER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Referer', operation: 'remove' }],
        },
        condition: {
          domainType: 'thirdParty',
          resourceTypes: SUBRESOURCE_TYPES,
        },
      });
    }

    if (settings.hardening.reduceFingerprintHeaders) {
      rules.push(
        {
          id: FINGERPRINT_HEADERS_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: CLIENT_HINT_HEADERS.map((header) => ({
              header,
              operation: 'remove' as const,
            })),
          },
          condition: {
            domainType: 'thirdParty',
            resourceTypes: SUBRESOURCE_TYPES,
          },
        },
        {
          id: X_CLIENT_DATA_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'X-Client-Data', operation: 'remove' },
            ],
          },
          condition: { resourceTypes: ALL_TYPES },
        },
      );
    }

    if (settings.hardening.sendGpc) {
      rules.push({
        id: GPC_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Sec-GPC', operation: 'set', value: '1' },
          ],
        },
        condition: { resourceTypes: ALL_TYPES },
      });
    }
  }

  return rules;
}
