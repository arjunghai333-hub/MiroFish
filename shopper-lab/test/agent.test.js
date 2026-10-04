'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideActionNoLlm } = require('../src/agent');

test('no-llm smoke policy opens a product if present and then stops', () => {
  const candidates = [
    { id: 1, kind: 'link', label: 'About', hint: 'generic' },
    { id: 2, kind: 'link', label: 'SG Bat', hint: 'product_link' },
    { id: 3, kind: 'button', label: 'Add to cart', hint: 'add_to_cart' },
  ];
  const first = decideActionNoLlm({ pageState: {}, candidates, stepIndex: 0 });
  assert.equal(first.action, 'open_product');
  assert.equal(first.candidate_id, 2);
  const second = decideActionNoLlm({ pageState: {}, candidates, stepIndex: 1 });
  assert.equal(second.action, 'stop');
});
