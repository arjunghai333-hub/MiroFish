'use strict';

function words(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9₹]+/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

function parsePrice(text) {
  const m = String(text || '').match(/(?:₹|rs\.?\s*)\s*([\d,]+(?:\.\d+)?)/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

function queryFor(persona) {
  const need = String(persona.shopping_for || 'cricket gear').toLowerCase();
  let q = 'cricket gear';
  if (/junior.*kit|starter.*kit|complete kit|full kit|two junior kits|gift kit/.test(need)) q = 'junior cricket kit';
  else if (/jersey|merch/.test(need)) q = 'cricket team jersey';
  else if (/shoe|spike/.test(need)) q = 'cricket shoes';
  else if (/wicket.*glove|keeping glove/.test(need)) q = 'wicket keeping gloves';
  else if (/wicket.*pad|keeping pad/.test(need)) q = 'wicket keeping pads';
  else if (/batting glove/.test(need)) q = 'batting gloves';
  else if (/thigh guard/.test(need)) q = 'thigh guard';
  else if (/helmet/.test(need)) q = 'cricket helmet';
  else if (/kit bag|bag/.test(need)) q = 'cricket kit bag';
  else if (/ball/.test(need)) q = 'cricket ball';
  else if (/bat/.test(need)) q = 'cricket bat';
  const brand = Array.isArray(persona.brand_preferences) && persona.brand_preferences.length
    ? persona.brand_preferences[0]
    : '';
  return [brand, q].filter(Boolean).join(' ').slice(0, 80);
}

function scoreCandidate(candidate, persona, pageState) {
  const label = String(candidate.label || '').toLowerCase();
  const desired = [...words(persona.shopping_for), ...words((persona.brand_preferences || []).join(' '))];
  let score = desired.reduce((n, w) => n + (label.includes(w) ? 3 : 0), 0);

  const product = (pageState.products || []).find(p => {
    const n = String(p.name || '').toLowerCase();
    return label.includes(n.slice(0, 28)) || n.includes(label.slice(0, 28));
  });
  if (product) {
    const price = parsePrice(product.price);
    if (price != null && persona.budget_inr) {
      if (price <= persona.budget_inr) score += 6;
      else if (price <= persona.budget_inr * 1.2) score += 2;
      else score -= 5;
    }
  }
  if (candidate.hint === 'product_link') score += 2;
  return score;
}

function visibleFriction(pageState, persona) {
  const text = String(pageState.textSummary || '').toLowerCase();
  const tags = [];
  if (/out of stock|unavailable|sold out/.test(text)) tags.push('stock');
  if (/shipping|delivery/.test(text) === false && persona.urgency === 'high') tags.push('shipping');
  if (/return|refund/.test(text) === false && (persona.main_objections || []).some(x => /return|warranty|replacement/i.test(x))) tags.push('returns');
  return tags;
}

function decideActionHeuristic({ persona, pageState, candidates, stepIndex, history = [] }) {
  const text = String(pageState.textSummary || '');
  const lower = text.toLowerCase();
  const friction = visibleFriction(pageState, persona);

  if (pageState.pageType === 'cart') {
    return {
      action: 'stop', candidate_id: null, search_query: null,
      reason: 'Persona-aware fallback reached cart. Checkout is intentionally outside this simulation.',
      purchase_intent: 82, friction_tags: friction,
    };
  }

  if (pageState.pageType === 'home' && stepIndex === 0) {
    return {
      action: 'search', candidate_id: null, search_query: queryFor(persona),
      reason: 'Persona-aware fallback starts with the shopper’s stated product need rather than browsing randomly.',
      purchase_intent: 45, friction_tags: [],
    };
  }

  if (pageState.pageType === 'search' || pageState.pageType === 'collection' || pageState.pageType === 'home') {
    const products = candidates.filter(c => c.hint === 'product_link');
    if (products.length) {
      products.sort((a, b) => scoreCandidate(b, persona, pageState) - scoreCandidate(a, persona, pageState));
      const best = products[0];
      return {
        action: 'open_product', candidate_id: best.id, search_query: null,
        reason: 'Persona-aware fallback chose the strongest visible product match using need, brand preference and budget.',
        purchase_intent: 55, friction_tags: friction,
      };
    }
    if (pageState.pageType !== 'search') {
      return {
        action: 'search', candidate_id: null, search_query: queryFor(persona),
        reason: 'No relevant product card was visible, so the shopper uses search.',
        purchase_intent: 40, friction_tags: ['navigation'],
      };
    }
    return {
      action: 'stop', candidate_id: null, search_query: null,
      reason: 'No relevant product result was visible for this persona’s stated need.',
      purchase_intent: 20, friction_tags: ['search'],
    };
  }

  if (pageState.pageType === 'product') {
    const price = parsePrice(text);
    if (/out of stock|unavailable|sold out/.test(lower)) {
      return {
        action: 'stop', candidate_id: null, search_query: null,
        reason: 'The product or current option is visibly unavailable, so this shopper abandons rather than forcing another choice.',
        purchase_intent: 25, friction_tags: [...new Set([...friction, 'stock'])],
      };
    }
    if (price != null && persona.budget_inr && price > persona.budget_inr * 1.2) {
      return {
        action: 'stop', candidate_id: null, search_query: null,
        reason: `Visible price ₹${price} is materially above this persona’s ₹${persona.budget_inr} budget.`,
        purchase_intent: 22, friction_tags: [...new Set([...friction, 'price_high'])],
      };
    }

    const variants = candidates.filter(c => c.hint === 'variant_option');
    const alreadyTriedVariant = history.some(h => h.reason && /variant/i.test(h.reason));
    if (variants.length && !alreadyTriedVariant) {
      const preferred = variants.find(c => /adult|short handle|sh|medium|\bm\b/i.test(c.label)) || variants[0];
      return {
        action: 'click_link', candidate_id: preferred.id, search_query: null,
        reason: 'The product has a visible variant choice. The fallback selects a plausible visible option before considering cart.',
        purchase_intent: 58, friction_tags: [...new Set([...friction, 'size'])],
      };
    }

    const add = candidates.find(c => c.hint === 'add_to_cart');
    if (add) {
      return {
        action: 'add_to_cart', candidate_id: add.id, search_query: null,
        reason: 'The visible product is within budget and in stock, so this persona expresses purchase intent by adding it to cart.',
        purchase_intent: 76, friction_tags: friction,
      };
    }

    return {
      action: 'stop', candidate_id: null, search_query: null,
      reason: 'The product page did not expose a safe add-to-cart path for this persona.',
      purchase_intent: 42, friction_tags: [...new Set([...friction, 'product_info'])],
    };
  }

  return {
    action: 'stop', candidate_id: null, search_query: null,
    reason: 'No safe, relevant next action was available.',
    purchase_intent: 25, friction_tags: friction,
  };
}

module.exports = { decideActionHeuristic, parsePrice, queryFor, scoreCandidate };
