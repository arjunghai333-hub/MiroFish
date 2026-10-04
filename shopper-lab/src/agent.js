/**
 * Single-persona shopping agent loop.
 *
 * Each step: read page state -> extract safe candidates -> decide one
 * action (via Claude, or a deterministic policy in --no-llm mode) ->
 * execute it through the safety-wrapped browser layer -> log a structured
 * event. Stops on explicit 'stop', on a blocked checkout attempt, on
 * exhausting the step budget, or on an unrecoverable error.
 */

'use strict';

const path = require('path');
const {
  createShopperPage,
  extractCandidates,
  clickCandidateInPage,
  summarizePage,
  screenshot,
  performSearch,
} = require('./browser');
const { decideAction } = require('./claude');
const { decideActionFreeLlm } = require('./freellm');
const { decideActionHeuristic } = require('./heuristic');
const { isAllowedAction } = require('./safety');

/**
 * Deterministic, LLM-free policy used for --no-llm smoke testing. It never
 * adds to cart, and prefers to look at one product then stop, so it is
 * cheap and safe to run against the live site.
 */
function decideActionNoLlm({ pageState, candidates, stepIndex }) {
  if (stepIndex === 0) {
    const productCandidate = candidates.find((c) => c.hint === 'product_link');
    const target = productCandidate || candidates.find((c) => c.kind === 'link');
    if (target) {
      return {
        action: target.hint === 'product_link' ? 'open_product' : 'click_link',
        candidate_id: target.id,
        search_query: null,
        reason: 'Deterministic smoke-test policy: open the first product-like link.',
        purchase_intent: 10,
        friction_tags: [],
      };
    }
  }
  return {
    action: 'stop',
    candidate_id: null,
    search_query: null,
    reason: 'Deterministic smoke-test policy: nothing further to explore safely.',
    purchase_intent: 5,
    friction_tags: [],
  };
}

async function safeScreenshot(page, filePath) {
  try {
    await screenshot(page, filePath);
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Run one persona's shopping session.
 *
 * @param {object} opts
 * @param {import('puppeteer').Browser} opts.browser
 * @param {object} opts.persona
 * @param {string} opts.startUrl
 * @param {number} opts.maxSteps
 * @param {boolean} opts.noLlm
 * @param {string} opts.screenshotsDir
 * @param {(event: object) => void} opts.logEvent
 * @param {object} [opts.claudeOptions]
 */
async function runAgent({ browser, persona, startUrl, maxSteps, noLlm, heuristic = false, freeLlm = false, screenshotsDir, logEvent, claudeOptions, freeLlmOptions }) {
  let blockedCheckout = false;
  let blockedCheckoutUrl = null;

  const page = await createShopperPage(browser, {
    onBlockedCheckout: (url) => {
      blockedCheckout = true;
      blockedCheckoutUrl = url;
    },
  });

  const history = [];
  let stopReason = 'max_steps_reached';
  let finalPurchaseIntent = 0;

  try {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (err) {
    logEvent({
      timestamp: new Date().toISOString(),
      persona_id: persona.user_id,
      step: 0,
      url: startUrl,
      page_title: null,
      page_type: 'error',
      visible_text_summary: null,
      products: [],
      action: 'stop',
      action_success: false,
      reason: `Initial navigation failed: ${err.message}`,
      purchase_intent: 0,
      friction_tags: ['navigation_error'],
    });
    await safeScreenshot(page, path.join(screenshotsDir, `persona-${persona.user_id}-error.png`));
    await page.browserContext().close().catch(() => {});
    return { personaId: persona.user_id, steps: 0, stopReason: 'navigation_error', finalPurchaseIntent: 0 };
  }

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    if (blockedCheckout) {
      logEvent({
        timestamp: new Date().toISOString(),
        persona_id: persona.user_id,
        step: stepIndex,
        url: page.url(),
        page_title: await page.title().catch(() => null),
        page_type: 'blocked',
        visible_text_summary: null,
        products: [],
        action: 'stop',
        action_success: false,
        reason: `Blocked checkout/payment/login navigation attempt: ${blockedCheckoutUrl}`,
        purchase_intent: finalPurchaseIntent,
        friction_tags: ['blocked_checkout'],
      });
      stopReason = 'blocked_checkout';
      break;
    }

    let pageState;
    try {
      pageState = await summarizePage(page);
    } catch (err) {
      logEvent({
        timestamp: new Date().toISOString(),
        persona_id: persona.user_id,
        step: stepIndex,
        url: page.url(),
        page_title: null,
        page_type: 'error',
        visible_text_summary: null,
        products: [],
        action: 'stop',
        action_success: false,
        reason: `Failed to read page state: ${err.message}`,
        purchase_intent: finalPurchaseIntent,
        friction_tags: ['page_read_error'],
      });
      await safeScreenshot(page, path.join(screenshotsDir, `persona-${persona.user_id}-error.png`));
      stopReason = 'page_read_error';
      break;
    }

    const candidates = await extractCandidates(page).catch(() => []);

    const decision = noLlm
      ? decideActionNoLlm({ pageState, candidates, stepIndex })
      : heuristic
        ? decideActionHeuristic({ persona, pageState, candidates, stepIndex, maxSteps, history })
        : freeLlm
          ? await decideActionFreeLlm({
              persona,
              pageState,
              candidates,
              stepIndex,
              maxSteps,
              history,
              freeLlmOptions,
            })
          : await decideAction({
              persona,
              pageState,
              candidates,
              stepIndex,
              maxSteps,
              history,
              claudeOptions,
            });

    let action = isAllowedAction(decision.action) ? decision.action : 'stop';
    if (noLlm && action === 'add_to_cart') {
      // Extra guard: --no-llm smoke mode must never add to cart, even if a
      // future deterministic policy accidentally suggested it.
      action = 'stop';
      decision.reason = 'Blocked: add_to_cart is disabled in --no-llm smoke mode.';
    }

    const selectedCandidate = decision.candidate_id == null ? null : candidates.find((c) => c.id === decision.candidate_id) || null;
    let actionSuccess = false;
    let executionNote = '';
    let stopAfterExternalIntent = false;

    try {
      if (action === 'stop') {
        actionSuccess = true;
        stopReason = 'model_stop';
      } else if (action === 'go_back') {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);
        actionSuccess = true;
      } else if (action === 'search') {
        if (decision.search_query) {
          actionSuccess = await performSearch(page, decision.search_query);
          if (!actionSuccess) executionNote = 'No search input found on page.';
        } else {
          executionNote = 'search action chosen without a search_query.';
        }
      } else if (action === 'click_link' || action === 'open_product' || action === 'add_to_cart') {
        if (!selectedCandidate) {
          executionNote = `${action} chosen without a valid pinned candidate.`;
        } else {
          const result = await clickCandidateInPage(page, selectedCandidate);
          actionSuccess = Boolean(result && result.clicked);
          if (result && result.externalIntent) {
            executionNote = `External contact/navigation intent recorded for ${selectedCandidate.label}; storefront session ended without leaving the controlled browser.`;
            stopAfterExternalIntent = true;
            stopReason = 'external_intent';
          } else if (!actionSuccess) {
            executionNote = `Pinned candidate ${decision.candidate_id} (${selectedCandidate.label}) was no longer available; failed closed.`;
          }
        }
      }
    } catch (err) {
      executionNote = `Execution error: ${err.message}`;
      actionSuccess = false;
    }

    finalPurchaseIntent = decision.purchase_intent;

    logEvent({
      timestamp: new Date().toISOString(),
      persona_id: persona.user_id,
      step: stepIndex,
      url: pageState.url,
      page_title: pageState.title,
      page_type: pageState.pageType,
      visible_text_summary: pageState.textSummary,
      products: pageState.products,
      action,
      candidate_id: decision.candidate_id ?? null,
      candidate_label: selectedCandidate ? selectedCandidate.label : null,
      candidate_hint: selectedCandidate ? selectedCandidate.hint : null,
      search_query: decision.search_query || null,
      action_success: actionSuccess,
      reason: executionNote ? `${decision.reason} | ${executionNote}` : decision.reason,
      purchase_intent: decision.purchase_intent,
      friction_tags: decision.friction_tags,
      decision_model: decision._model || (noLlm ? 'deterministic-smoke' : heuristic ? 'persona-heuristic' : freeLlm ? 'freellm-unknown' : 'claude'),
      model_usage: decision._usage || null,
    });

    history.push({ step: stepIndex, action, candidate: selectedCandidate ? selectedCandidate.label : null, success: actionSuccess, reason: decision.reason });

    if (action === 'stop') {
      stopReason = 'model_stop';
      break;
    }
    if (stopAfterExternalIntent) break;
    if (blockedCheckout) {
      stopReason = 'blocked_checkout';
      break;
    }
  }

  await safeScreenshot(page, path.join(screenshotsDir, `persona-${persona.user_id}-final.png`));
  await page.browserContext().close().catch(() => {});

  return {
    personaId: persona.user_id,
    steps: history.length,
    stopReason,
    finalPurchaseIntent,
  };
}

module.exports = {
  runAgent,
  decideActionNoLlm,
};
