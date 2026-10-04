/**
 * Safety guards for the Shopper Lab browser sessions.
 *
 * Two independent layers:
 *  - Hard navigation/request blocking for checkout, payment, login, and
 *    account-creation surfaces (never allowed, regardless of LLM output).
 *  - Analytics/beacon request blocking so simulated sessions don't pollute
 *    real Google/Meta/TikTok/Shopify analytics.
 */

'use strict';

const USER_AGENT_FRAGMENT = 'MiroFishShopperLab/1.0';
const SIMULATION_HEADER = { 'X-MiroFish-Simulation': '1' };

const MOBILE_USER_AGENT =
  `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/124.0.0.0 Mobile Safari/537.36 ${USER_AGENT_FRAGMENT}`;

const DEFAULT_VIEWPORT = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

// Any URL whose path/query contains one of these substrings is a hard block:
// simulated shoppers must never reach checkout, payment, login, or account flows.
const BLOCKED_URL_PATTERNS = [
  'checkout',
  'checkouts',
  '/account/login',
  '/account/register',
  '/account/register',
  'payments',
  'wallet',
  'shopify_pay',
  'shop_pay',
  'accelerated checkout',
  'accelerated-checkout',
  '/cart/checkout',
];

// Request hosts/paths that are analytics/beacon traffic we don't want to
// pollute with simulated sessions. The storefront itself must keep working.
const ANALYTICS_URL_PATTERNS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'google.com/ccm',
  'googleadservices.com',
  'googlesyndication.com',
  'connect.facebook.net',
  'facebook.com/tr',
  'facebook.com/tr/',
  'analytics.tiktok.com',
  'business-api.tiktok.com',
  'monorail-edge.shopifysvc.com',
  'sentry.io',
  'clarity.ms',
  'hotjar.com',
  'segment.io',
  'segment.com',
  'snapchat.com/p',
  'pinterest.com/ct',
  'bat.bing.com',
];

function urlContainsAny(url, patterns) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

function isBlockedCheckoutUrl(url) {
  return urlContainsAny(url, BLOCKED_URL_PATTERNS);
}

function isAnalyticsUrl(url) {
  return urlContainsAny(url, ANALYTICS_URL_PATTERNS);
}

/**
 * Decide what to do with an outgoing request/navigation.
 * Returns one of: 'allow', 'block_checkout', 'block_analytics'.
 */
function classifyRequest(url) {
  if (isBlockedCheckoutUrl(url)) return 'block_checkout';
  if (isAnalyticsUrl(url)) return 'block_analytics';
  return 'allow';
}

// The finite set of actions the LLM (or deterministic policy) may choose.
// No arbitrary JS/selectors are ever accepted from model output.
const ALLOWED_ACTIONS = Object.freeze([
  'click_link',
  'search',
  'open_product',
  'add_to_cart',
  'go_back',
  'stop',
]);

function isAllowedAction(action) {
  return ALLOWED_ACTIONS.includes(action);
}

module.exports = {
  USER_AGENT_FRAGMENT,
  SIMULATION_HEADER,
  MOBILE_USER_AGENT,
  DEFAULT_VIEWPORT,
  BLOCKED_URL_PATTERNS,
  ANALYTICS_URL_PATTERNS,
  isBlockedCheckoutUrl,
  isAnalyticsUrl,
  classifyRequest,
  ALLOWED_ACTIONS,
  isAllowedAction,
};
