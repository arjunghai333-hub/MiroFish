/**
 * Puppeteer wrapper for the Shopper Lab.
 *
 * Owns: browser/page lifecycle, mobile viewport + UA + simulation header,
 * request interception (checkout/analytics blocking), candidate extraction
 * (numeric-id links/buttons so the LLM never sees raw selectors/URLs), and
 * page-state summarization (title, page type, visible text, product list).
 */

'use strict';

const fs = require('node:fs');
const puppeteer = require('puppeteer');
const {
  MOBILE_USER_AGENT,
  DEFAULT_VIEWPORT,
  SIMULATION_HEADER,
  classifyRequest,
} = require('./safety');

async function launchBrowser({ headless = true } = {}) {
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (fs.existsSync(macChrome) ? macChrome : undefined);
  return puppeteer.launch({
    headless,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
}

/**
 * Create a page configured for mobile shopping, with request interception
 * that hard-blocks checkout/payment/login URLs and analytics/beacon traffic.
 *
 * `onBlockedCheckout(url)` is called synchronously whenever a checkout-class
 * URL is intercepted, so the caller can log `blocked_checkout` and stop the
 * agent for this persona.
 */
async function createShopperPage(browser, { onBlockedCheckout } = {}) {
  // Every synthetic shopper gets an isolated browser context so cookies,
  // cart state, localStorage and Shopify session data cannot leak between
  // personas. This is essential for independent customer-session evidence.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(DEFAULT_VIEWPORT);
  await page.setUserAgent(MOBILE_USER_AGENT);
  await page.setExtraHTTPHeaders(SIMULATION_HEADER);
  await page.setRequestInterception(true);

  page.on('request', (request) => {
    const url = request.url();
    const verdict = classifyRequest(url);
    if (verdict === 'block_checkout') {
      // Shopify may preload checkout JavaScript in the background on ordinary
      // storefront pages. Abort that request, but only stop the shopper when
      // the blocked request is an actual document/navigation attempt.
      if (request.isNavigationRequest() && typeof onBlockedCheckout === 'function') {
        try {
          onBlockedCheckout(url);
        } catch (_err) {
          // Never let a logging error break request handling.
        }
      }
      request.abort();
      return;
    }
    if (verdict === 'block_analytics') {
      request.abort();
      return;
    }
    request.continue();
  });

  return page;
}

/**
 * Extract a bounded set of safely-clickable candidates (links and buttons)
 * from the current page, each tagged with a small numeric id. The runner
 * sends only these candidates (never raw selectors/URLs) to the model.
 */
async function extractCandidates(page, { limit = 40 } = {}) {
  return page.evaluate((maxCandidates) => {
    function visible(el) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none';
    }

    function textOf(el) {
      return (el.innerText || el.textContent || el.value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    }

    // Candidate ids must remain stable while the model reasons. Clear any
    // ids from a previous step, then pin the current visible element itself.
    document.querySelectorAll('[data-mirofish-candidate-id]').forEach((el) => {
      el.removeAttribute('data-mirofish-candidate-id');
    });

    const nodes = Array.from(
      document.querySelectorAll('a[href], button, input[type="submit"], [role="button"]')
    );

    const candidates = [];
    for (const el of nodes) {
      if (candidates.length >= maxCandidates) break;
      if (!visible(el)) continue;
      const label = textOf(el);
      if (!label) continue;

      const href = el.tagName === 'A' ? el.getAttribute('href') : null;
      let kind = 'button';
      if (el.tagName === 'A') kind = 'link';

      const haystack = `${label} ${href || ''} ${el.className || ''}`.toLowerCase();
      const looksLikeAddToCart = /add to cart|add-to-cart|buy now|add to bag/.test(haystack);
      const looksLikeProduct = kind === 'link' && href && /\/products\//.test(href);
      const optionContainer = el.closest('fieldset, variant-selects, variant-radios, [class*="variant" i], [class*="option" i], [data-option]');
      const looksLikeVariant = Boolean(optionContainer) && kind === 'button' && !looksLikeAddToCart;

      const id = candidates.length + 1;
      el.setAttribute('data-mirofish-candidate-id', String(id));
      candidates.push({
        id,
        kind,
        label,
        href: href || null,
        hint: looksLikeAddToCart ? 'add_to_cart' : looksLikeProduct ? 'product_link' : looksLikeVariant ? 'variant_option' : 'generic',
      });
    }

    return candidates;
  }, limit);
}

/**
 * Summarize current page: title, best-guess page type, a short visible-text
 * excerpt, and any product name/price pairs found on the page.
 */
async function summarizePage(page) {
  const url = page.url();
  const title = await page.title().catch(() => '');

  const { textSummary, products } = await page.evaluate(() => {
    const body = document.body ? document.body.innerText || '' : '';
    const textSummary = body.replace(/\s+/g, ' ').trim().slice(0, 600);

    const products = [];
    const priceRegex = /(₹|Rs\.?\s?)\s?[\d,]+(\.\d{1,2})?/i;

    // Shopify themes vary a lot; heuristically scan common product-card
    // containers for a name-like heading and a price-like text node.
    const cardSelectors = [
      '[class*="product-card"]',
      '[class*="product-item"]',
      '[class*="grid__item"]',
      '[class*="ProductItem"]',
      'li.grid__item',
    ];
    const seen = new Set();
    for (const selector of cardSelectors) {
      const cards = document.querySelectorAll(selector);
      for (const card of cards) {
        if (products.length >= 15) break;
        const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
        if (!text || !priceRegex.test(text)) continue;
        const heading = card.querySelector('h1, h2, h3, a');
        const name = heading ? heading.innerText.replace(/\s+/g, ' ').trim().slice(0, 100) : null;
        const priceMatch = text.match(priceRegex);
        const price = priceMatch ? priceMatch[0] : null;
        if (!name || !price) continue;
        const key = `${name}|${price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        products.push({ name, price });
      }
      if (products.length >= 15) break;
    }

    return { textSummary, products };
  });

  let pageType = 'other';
  const lowerUrl = url.toLowerCase();
  if (/\/products\//.test(lowerUrl)) pageType = 'product';
  else if (/\/collections\//.test(lowerUrl)) pageType = 'collection';
  else if (/\/cart/.test(lowerUrl)) pageType = 'cart';
  else if (/\/search/.test(lowerUrl)) pageType = 'search';
  else if (lowerUrl.replace(/\/$/, '').match(/^https?:\/\/[^/]+$/)) pageType = 'home';

  return { url, title, pageType, textSummary, products };
}

/**
 * Click the candidate with the given numeric id. Re-runs the same
 * deterministic extraction query used by extractCandidates() and clicks
 * the matching element directly (no arbitrary JS from the model — only
 * this fixed click routine). Must be called before any navigation happens
 * so the DOM (and therefore candidate ordering) matches what was extracted.
 */
async function clickCandidateInPage(page, candidate) {
  if (!candidate || !candidate.id) return { clicked: false, reason: 'missing_candidate' };

  if (candidate.kind === 'link' && candidate.href) {
    let target;
    try { target = new URL(candidate.href, page.url()); }
    catch (_err) { return { clicked: false, reason: 'invalid_href' }; }

    if (!['http:', 'https:'].includes(target.protocol)) {
      return { clicked: true, externalIntent: true, label: candidate.label, target: target.toString() };
    }
    const currentOrigin = new URL(page.url()).origin;
    if (target.origin !== currentOrigin) {
      return { clicked: true, externalIntent: true, label: candidate.label, target: target.toString() };
    }

    const response = await page.goto(target.toString(), {
      waitUntil: 'domcontentloaded', timeout: 10000,
    }).catch(() => null);
    return {
      clicked: Boolean(response || page.url() === target.toString()),
      navigated: true,
      label: candidate.label,
      target: target.toString(),
    };
  }

  const result = await page.evaluate((id) => {
    const el = document.querySelector('[data-mirofish-candidate-id="' + id + '"]');
    if (!el) return { clicked: false, reason: 'candidate_pin_missing' };
    const label = (el.innerText || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    el.scrollIntoView({ block: 'center' });
    el.click();
    return { clicked: true, label };
  }, candidate.id);
  if (result.clicked) await new Promise((resolve) => setTimeout(resolve, 650));
  return result;
}

async function screenshot(page, filePath) {
  await page.screenshot({ path: filePath, fullPage: false });
}

async function performSearch(page, query) {
  if (!query || !String(query).trim()) return false;
  // Use Shopify's first-party search route directly. Mobile themes often keep
  // the visible search input inside a drawer/overlay, which can make synthetic
  // keypresses appear successful without actually navigating.
  const current = new URL(page.url());
  const searchUrl = new URL('/search', current.origin);
  searchUrl.searchParams.set('q', String(query).trim());
  const response = await page.goto(searchUrl.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 10000,
  }).catch(() => null);
  return Boolean(response && response.status() < 400 && /\/search(?:\?|$)/.test(page.url()));
}

module.exports = {
  launchBrowser,
  createShopperPage,
  extractCandidates,
  clickCandidateInPage,
  summarizePage,
  screenshot,
  performSearch,
};
