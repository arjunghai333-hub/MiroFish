'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyRequest,
  isBlockedCheckoutUrl,
  isAnalyticsUrl,
  isAllowedAction,
} = require('../src/safety');

test('hard blocks checkout and payment URLs', () => {
  const urls = [
    'https://www.indiancricketstore.com/checkout',
    'https://www.indiancricketstore.com/checkouts/cn/abc',
    'https://pay.shopify.com/payments/abc',
    'https://www.indiancricketstore.com/account/login',
    'https://example.com/wallet',
    'https://example.com/shopify_pay',
  ];
  for (const url of urls) {
    assert.equal(isBlockedCheckoutUrl(url), true, url);
    assert.equal(classifyRequest(url), 'block_checkout', url);
  }
});

test('blocks common analytics but allows normal storefront assets', () => {
  assert.equal(isAnalyticsUrl('https://www.google-analytics.com/g/collect?v=2'), true);
  assert.equal(classifyRequest('https://monorail-edge.shopifysvc.com/v1/produce'), 'block_analytics');
  assert.equal(classifyRequest('https://www.indiancricketstore.com/products/example.js'), 'allow');
  assert.equal(classifyRequest('https://cdn.shopify.com/s/files/theme.css'), 'allow');
});

test('only finite safe actions are allowed', () => {
  for (const action of ['click_link', 'search', 'open_product', 'add_to_cart', 'go_back', 'stop']) {
    assert.equal(isAllowedAction(action), true);
  }
  assert.equal(isAllowedAction('checkout'), false);
  assert.equal(isAllowedAction('evaluate_js'), false);
});
