'use strict';

const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildPrompt, normalizeDecision, DECISION_JSON_SCHEMA } = require('./claude');

const DEFAULT_BASE_URL = process.env.MIROFISH_FREE_LLM_BASE_URL || 'http://127.0.0.1:31415/v1';
const DEFAULT_MODEL = process.env.MIROFISH_FREE_LLM_MODEL || 'auto';
const DEFAULT_TIMEOUT_MS = Number(process.env.MIROFISH_FREE_LLM_TIMEOUT_MS || 20000);

function readLocalFreeLlmKey() {
  if (process.env.MIROFISH_FREE_LLM_API_KEY) return process.env.MIROFISH_FREE_LLM_API_KEY;

  const dbPath = process.env.MIROFISH_FREE_LLM_DB ||
    path.join(os.homedir(), 'Library', 'Application Support', 'FreeLLMAPI', 'freeapi.db');

  try {
    const key = execFileSync(
      '/usr/bin/sqlite3',
      [dbPath, "select value from settings where key='unified_api_key' limit 1;"],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (key) return key;
  } catch (_err) {}

  throw new Error(
    'FreeLLM API key unavailable. Set MIROFISH_FREE_LLM_API_KEY or run the local FreeLLMAPI app.'
  );
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('FreeLLM returned empty content');

  try { return JSON.parse(raw); } catch (_err) {}

  const unfenced = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try { return JSON.parse(unfenced); } catch (_err) {}

  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(unfenced.slice(first, last + 1));
  throw new Error('FreeLLM response did not contain a parseable JSON object');
}

function validateRawDecision(raw) {
  const required = [
    'action', 'candidate_id', 'search_query', 'reason', 'purchase_intent', 'friction_tags'
  ];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('FreeLLM decision is not a JSON object');
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      const err = new Error('FreeLLM decision missing required field: ' + key);
      err.modelOutputInvalid = true;
      throw err;
    }
  }
  if (typeof raw.reason !== 'string' || !raw.reason.trim()) {
    const err = new Error('FreeLLM decision reason is empty');
    err.modelOutputInvalid = true;
    throw err;
  }
  if (!Number.isFinite(Number(raw.purchase_intent))) {
    const err = new Error('FreeLLM purchase_intent is invalid');
    err.modelOutputInvalid = true;
    throw err;
  }
  if (!Array.isArray(raw.friction_tags)) {
    const err = new Error('FreeLLM friction_tags is not an array');
    err.modelOutputInvalid = true;
    throw err;
  }
  return raw;
}

async function postChat({
  prompt,
  baseUrl = DEFAULT_BASE_URL,
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  withResponseFormat = true,
}) {
  const apiKey = readLocalFreeLlmKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a realistic ecommerce shopper decision engine. Stay in persona. Return only one JSON object matching the requested fields. Never choose checkout or payment.'
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.25,
    max_tokens: 700,
  };
  if (withResponseFormat) body.response_format = { type: 'json_object' };

  try {
    const response = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      const err = new Error('FreeLLM HTTP ' + response.status + ': ' + text.slice(0, 500));
      err.status = response.status;
      throw err;
    }

    const envelope = JSON.parse(text);
    const choice = envelope && envelope.choices && envelope.choices[0];
    const content = choice && choice.message && choice.message.content;
    if (typeof content !== 'string') throw new Error('FreeLLM response had no message content');

    return {
      raw: extractJson(content),
      model: envelope.model || model,
      usage: envelope.usage || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function decideActionFreeLlm(context) {
  const prompt = buildPrompt(context) +
    '\n\nREQUIRED JSON SCHEMA\n' +
    JSON.stringify(DECISION_JSON_SCHEMA) +
    '\nEvery required field must be present.';

  const requestedModel = (context.freeLlmOptions && context.freeLlmOptions.model) || DEFAULT_MODEL;
  const models = requestedModel === 'auto'
    ? ['auto', 'gemma4:31b', 'qwen/qwen3.8-27b', 'agnes-2.5-flash', 'deepseek-v4-flash', 'glm-5.2-fp8']
    : [requestedModel, 'gemma4:31b', 'auto', 'qwen/qwen3.8-27b', 'agnes-2.5-flash', 'deepseek-v4-flash'];

  let response = null;
  let lastError = null;

  for (const model of [...new Set(models)]) {
    try {
      try {
        response = await postChat({
          prompt,
          ...(context.freeLlmOptions || {}),
          model,
        });
      } catch (err) {
        if (err.status === 400 || err.status === 422) {
          response = await postChat({
            prompt,
            ...(context.freeLlmOptions || {}),
            model,
            withResponseFormat: false,
          });
        } else {
          throw err;
        }
      }
      if (response) {
        validateRawDecision(response.raw);
        break;
      }
    } catch (err) {
      lastError = err;
      const retryable =
        err.name === 'AbortError' ||
        err.status === 408 ||
        err.status === 409 ||
        err.status === 429 ||
        (Number(err.status) >= 500 && Number(err.status) < 600) ||
        err.modelOutputInvalid === true;
      if (!retryable) throw err;
      response = null;
    }
  }

  if (!response) {
    throw lastError || new Error('FreeLLM failed across all configured fallback models');
  }

  const decision = normalizeDecision(response.raw);

  if (
    decision.candidate_id != null &&
    !context.candidates.some((c) => c.id === decision.candidate_id)
  ) {
    return {
      action: 'stop',
      candidate_id: null,
      search_query: null,
      reason: 'Stopped safely because FreeLLM selected invalid candidate_id ' + decision.candidate_id + '.',
      purchase_intent: decision.purchase_intent,
      friction_tags: [...decision.friction_tags, 'invalid_candidate'].slice(0, 8),
      _model: response.model,
    };
  }

  if (
    ['click_link', 'open_product', 'add_to_cart'].includes(decision.action) &&
    decision.candidate_id == null
  ) {
    return {
      action: 'stop',
      candidate_id: null,
      search_query: null,
      reason: 'Stopped safely because FreeLLM chose ' + decision.action + ' without a candidate_id.',
      purchase_intent: decision.purchase_intent,
      friction_tags: [...decision.friction_tags, 'invalid_candidate'].slice(0, 8),
      _model: response.model,
    };
  }

  decision._model = response.model;
  decision._usage = response.usage;
  return decision;
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  readLocalFreeLlmKey,
  extractJson,
  validateRawDecision,
  postChat,
  decideActionFreeLlm,
};
