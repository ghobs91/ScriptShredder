/**
 * Parameters commonly added by ad networks, email campaigns, and social
 * platforms. Query strings are stripped at navigation/link time by the
 * content script; they are never sent to a server by this extension.
 */
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  '_hsenc',
  '_hsmi',
  'hsctatracking',
  'vero_id',
  'vero_conv',
  'oly_anon_id',
  'oly_enc_id',
  'rb_clickid',
  'wickedid',
  's_cid',
  'igshid',
  'igsh',
  'epik',
  'sc_cid',
  'trk_contact',
  'trk_msg',
  'trk_module',
  'trk_sid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'utm_cid',
  'utm_reader',
  'utm_referrer',
  'utm_social',
  'utm_social-type',
  'pk_campaign',
  'pk_kwd',
  'pk_source',
  'pk_medium',
  'piwik_campaign',
  'piwik_kwd',
  'mtm_campaign',
  'mtm_source',
  'mtm_medium',
  'mtm_keyword',
  'mtm_content',
  'mtm_cid',
  'mtm_group',
  'mtm_placement',
  'matomo_campaign',
  'matomo_source',
  'matomo_medium',
  'matomo_keyword',
  'matomo_content',
  'matomo_cid',
  'matomo_group',
  'matomo_placement',
]);

const TRACKING_PREFIXES = ['utm_', 'pk_', 'mtm_', 'matomo_'];

export const TRACKING_PARAM_NAMES = [...TRACKING_PARAMS].sort();

export function isTrackingParam(key: string): boolean {
  const name = key.toLowerCase();
  return (
    TRACKING_PARAMS.has(name) ||
    TRACKING_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/**
 * Returns the URL without known tracking parameters. Preserves the path,
 * remaining query parameters, and fragment. Non-HTTP(S) and invalid URLs are
 * returned unchanged.
 */
export function stripTrackingParams(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return input;

  const keys = [...url.searchParams.keys()];
  let changed = false;

  for (const key of keys) {
    if (!isTrackingParam(key)) continue;
    url.searchParams.delete(key);
    changed = true;
  }

  return changed ? url.toString() : input;
}
