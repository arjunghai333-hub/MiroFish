'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseClaudeJsonOutput } = require('../src/claude');

test('parses and normalizes structured_output from claude CLI JSON wrapper', () => {
  const stdout = JSON.stringify({
    is_error: false,
    result: '{"action":"stop"}',
    structured_output: { action: 'stop', reason: 'done' },
  });
  const parsed = parseClaudeJsonOutput(stdout);
  assert.equal(parsed.action, 'stop');
  assert.equal(parsed.reason, 'done');
  assert.equal(parsed.candidate_id, null);
  assert.equal(parsed.search_query, null);
  assert.equal(parsed.purchase_intent, 0);
  assert.deepEqual(parsed.friction_tags, []);
});

test('falls back to JSON in result field and normalizes defaults', () => {
  const stdout = JSON.stringify({
    is_error: false,
    result: '{"action":"search","search_query":"SG bat"}',
  });
  const parsed = parseClaudeJsonOutput(stdout);
  assert.equal(parsed.action, 'search');
  assert.equal(parsed.search_query, 'SG bat');
  assert.equal(parsed.candidate_id, null);
  assert.equal(parsed.reason, 'No reason provided.');
  assert.equal(parsed.purchase_intent, 0);
  assert.deepEqual(parsed.friction_tags, []);
});

test('rejects malformed wrapper and claude errors', () => {
  assert.throws(() => parseClaudeJsonOutput('not-json'), /valid JSON/);
  assert.throws(
    () => parseClaudeJsonOutput(JSON.stringify({ is_error: true, result: 'boom' })),
    /reported an error/
  );
});
