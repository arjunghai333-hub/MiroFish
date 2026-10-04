'use strict';

const { spawn } = require('node:child_process');
const { ALLOWED_ACTIONS } = require('./safety');

const DEFAULT_MODEL = process.env.MIROFISH_SHOPPER_MODEL || 'sonnet';
const DEFAULT_EFFORT = process.env.MIROFISH_SHOPPER_EFFORT || 'low';
const DEFAULT_TIMEOUT_MS = Number(process.env.MIROFISH_SHOPPER_CLAUDE_TIMEOUT_MS || 60000);
const CLAUDE_BIN = process.env.MIROFISH_SHOPPER_CLAUDE_BIN || 'claude';

const DECISION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: [...ALLOWED_ACTIONS] },
    candidate_id: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
    search_query: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    reason: { type: 'string' },
    purchase_intent: { type: 'integer', minimum: 0, maximum: 100 },
    friction_tags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
  },
  required: ['action', 'candidate_id', 'search_query', 'reason', 'purchase_intent', 'friction_tags'],
  additionalProperties: false,
};

function normalizeDecision(raw) {
  const action = ALLOWED_ACTIONS.includes(raw?.action) ? raw.action : 'stop';
  const n = raw?.candidate_id == null ? null : Number(raw.candidate_id);
  const candidateId = Number.isInteger(n) && n > 0 ? n : null;
  const searchQuery = typeof raw?.search_query === 'string' && raw.search_query.trim()
    ? raw.search_query.trim()
    : null;
  let purchaseIntent = Number(raw?.purchase_intent);
  if (!Number.isFinite(purchaseIntent)) purchaseIntent = 0;
  purchaseIntent = Math.max(0, Math.min(100, Math.round(purchaseIntent)));
  const reason = typeof raw?.reason === 'string' && raw.reason.trim()
    ? raw.reason.trim()
    : 'No reason provided.';
  const frictionTags = Array.isArray(raw?.friction_tags)
    ? raw.friction_tags
        .filter((x) => typeof x === 'string' && x.trim())
        .map((x) => x.trim().toLowerCase().replace(/\s+/g, '_'))
        .slice(0, 8)
    : [];

  return {
    action,
    candidate_id: candidateId,
    search_query: searchQuery,
    reason,
    purchase_intent: purchaseIntent,
    friction_tags: frictionTags,
  };
}

function parseClaudeJsonOutput(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`claude CLI did not return valid JSON: ${err.message}`);
  }
  if (envelope.is_error) {
    throw new Error(`claude CLI reported an error: ${envelope.result || envelope.subtype || 'unknown error'}`);
  }

  let decision = envelope.structured_output;
  if (!decision && typeof envelope.result === 'string') {
    try {
      decision = JSON.parse(envelope.result);
    } catch (err) {
      throw new Error(`claude CLI result was not parseable JSON: ${err.message}`);
    }
  }
  if (!decision || typeof decision !== 'object') {
    throw new Error('claude CLI response contained no usable structured output');
  }
  return normalizeDecision(decision);
}

const parseClaudeResponse = parseClaudeJsonOutput;

function buildPrompt({ persona, pageState, candidates, stepIndex, maxSteps, history = [] }) {
  const safeCandidates = candidates.map(({ id, kind, label, hint }) => ({ id, kind, label, hint }));
  return [
    'You are role-playing ONE realistic Indian cricket-equipment shopper browsing an ecommerce store on a mobile phone.',
    'Stay in character. You are a shopper, not a QA tester.',
    'Choose exactly one next action from: click_link, search, open_product, add_to_cart, go_back, stop.',
    'Never choose checkout, payment, customer login/account creation, or anything outside that action list.',
    'For click_link, open_product or add_to_cart, candidate_id MUST be one of the supplied numeric candidates.',
    'click_link may also be used for a safe visible option/button such as a size, hand, colour, pack quantity, tab, filter or continue-shopping control.',
    'Never add a size-dependent or variant-dependent product using an obviously wrong/default option. If size/hand/colour/pack matters, deliberately choose or verify the suitable option first, using the visible candidates or product details. If you cannot determine a suitable variant, do not add it to cart.',
    'For search, provide a natural search_query.',
    'purchase_intent is 0-100 for buying from this store in this session.',
    'friction_tags should be short snake_case labels grounded in what is actually visible, such as price_high, no_offer, combo_missing, trust, shipping, navigation, search, size, product_info, stock, authenticity, returns, cod.',
    'Do not invent a site problem just because the persona expected something. Separate preference from observed friction.',
    '',
    'PERSONA',
    JSON.stringify(persona),
    '',
    `STEP ${stepIndex + 1} OF ${maxSteps}`,
    'CURRENT PAGE',
    JSON.stringify(pageState),
    '',
    'SAFE CANDIDATES',
    JSON.stringify(safeCandidates),
    '',
    'RECENT HISTORY',
    JSON.stringify(history.slice(-4)),
    '',
    'Return only the structured decision required by the JSON schema.',
  ].join('\n');
}

function runClaudeCli(prompt, { model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--model', model,
      '--effort', effort,
      '--output-format', 'json',
      '--json-schema', JSON.stringify(DECISION_JSON_SCHEMA),
      '--permission-mode', 'dontAsk',
      '--permission-prompts', 'none',
      '--no-session-persistence',
    ];

    const child = spawn(CLAUDE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(reject, new Error(`claude CLI exited with code ${code}: ${stderr.slice(0, 1500)}`));
        return;
      }
      finish(resolve, stdout);
    });
  });
}

async function decideAction(context) {
  try {
    const prompt = buildPrompt(context);
    const stdout = await runClaudeCli(prompt, context.claudeOptions || {});
    const decision = parseClaudeJsonOutput(stdout);

    if (
      decision.candidate_id != null &&
      !context.candidates.some((c) => c.id === decision.candidate_id)
    ) {
      return {
        action: 'stop',
        candidate_id: null,
        search_query: null,
        reason: `Stopped safely because the model selected invalid candidate_id ${decision.candidate_id}.`,
        purchase_intent: decision.purchase_intent,
        friction_tags: [...decision.friction_tags, 'invalid_candidate'].slice(0, 8),
      };
    }

    if (['click_link', 'open_product', 'add_to_cart'].includes(decision.action) && decision.candidate_id == null) {
      return {
        action: 'stop',
        candidate_id: null,
        search_query: null,
        reason: `Stopped safely because ${decision.action} had no candidate_id.`,
        purchase_intent: decision.purchase_intent,
        friction_tags: [...decision.friction_tags, 'invalid_candidate'].slice(0, 8),
      };
    }

    return decision;
  } catch (err) {
    return {
      action: 'stop',
      candidate_id: null,
      search_query: null,
      reason: `LLM failed safely: ${err.message}`,
      purchase_intent: 0,
      friction_tags: ['llm_error'],
    };
  }
}

module.exports = {
  DECISION_JSON_SCHEMA,
  DEFAULT_MODEL,
  DEFAULT_EFFORT,
  buildPrompt,
  normalizeDecision,
  parseClaudeJsonOutput,
  parseClaudeResponse,
  runClaudeCli,
  decideAction,
};
