'use strict';

const fs = require('node:fs');

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function sortCounts(obj) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function uniquePersonaCount(events, predicate) {
  return new Set(events.filter(predicate).map((e) => e.persona_id)).size;
}

function normalizeTag(tag) {
  return String(tag || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function recommendationsFromSignals(frictionCounts, events) {
  const text = events.map((e) => `${e.reason || ''} ${(e.friction_tags || []).join(' ')}`).join(' ').toLowerCase();
  const scored = [];
  const add = (score, experiment, why) => scored.push({ score, experiment, why });

  const c = (tag) => frictionCounts[tag] || 0;
  add(c('price_high') * 4 + (text.match(/price|expensive|budget/g) || []).length,
    'Test a sharper opening price proposition or Price Promise placement',
    'Price sensitivity appeared in synthetic shopper reasoning.');
  add((c('no_offer') + c('offer_missing')) * 5 + (text.match(/offer|discount|deal/g) || []).length,
    'A/B test a first-order offer against full-price control',
    'Some personas looked for a clear reason to buy now.');
  add(c('combo_missing') * 6 + (text.match(/combo|bundle|kit/g) || []).length,
    'Launch 2–3 high-intent bundles: junior starter kit, batting essentials, wicketkeeping set',
    'Bundles can simplify choice and create visible value without cutting every SKU.');
  add((c('trust') + c('authenticity')) * 5 + (text.match(/trust|genuine|authentic|fake/g) || []).length,
    'Strengthen authenticity proof above the fold on product pages',
    'Trust and genuine-product concerns are common online cricket-equipment objections.');
  add((c('shipping') + c('returns')) * 5 + (text.match(/delivery|shipping|return|dispatch/g) || []).length,
    'Make dispatch ETA, delivery expectation and returns promise visible before cart',
    'Uncertainty about fulfilment can stop purchase intent before checkout.');
  add(c('cod') * 6 + (text.match(/cod|cash on delivery/g) || []).length,
    'Test prominent COD/payment-method reassurance where available',
    'Payment confidence can materially affect Indian ecommerce conversion.');
  add(c('navigation') * 5 + (text.match(/navigation|overwhelming|find/g) || []).length,
    'Simplify mobile discovery around Bats, Kits, Protection, Shoes and Shop by Player',
    'Mobile shoppers should reach a relevant product in very few taps.');
  add(c('search') * 6 + (text.match(/search/g) || []).length,
    'Improve mobile search visibility and merchandising for brand/model queries',
    'High-intent shoppers often arrive knowing the brand or model they want.');
  add(c('size') * 6 + (text.match(/size|fit/g) || []).length,
    'Put size guidance beside variant selectors and add junior/age cues',
    'Sizing uncertainty is especially costly for junior gear, gloves, pads and helmets.');
  add(c('product_info') * 5 + (text.match(/spec|photo|weight|willow|grade|detail/g) || []).length,
    'Increase decision-grade product information: specs, weight/grade, close-up images and comparison cues',
    'Cricket gear is technical and buyers need enough evidence to buy without touching it.');
  add(c('stock') * 6 + (text.match(/stock|availability|sold out/g) || []).length,
    'Surface stock/size availability earlier and offer restock alerts',
    'Dead-end variant selection destroys high-intent sessions.');
  add((text.match(/review|rating/g) || []).length,
    'Add stronger photo/review social proof on high-value products',
    'Real customer proof is a better trust signal than synthetic research.');
  add(2, 'Create a compare-two-products flow for bats, gloves and wicketkeeping gear',
    'Cricket shoppers frequently evaluate adjacent models with small spec/price differences.');
  add(2, 'Test one clear value message in the hero rather than multiple competing claims',
    'The homepage should explain why this store deserves the next click.');

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ experiment, why, score }) => ({ experiment, why, signal_score: score }));
}

function buildSummary({ personas, events, results }) {
  const frictionCounts = {};
  for (const event of events) {
    for (const raw of event.friction_tags || []) {
      const tag = normalizeTag(raw);
      if (!tag || tag === 'none') continue;
      frictionCounts[tag] = (frictionCounts[tag] || 0) + 1;
    }
  }

  const productTitles = events
    .filter((e) => e.page_type === 'product' && e.page_title)
    .map((e) => e.page_title.replace(/\s+[|–-].*$/, '').trim());

  const stopReasonCounts = countBy(results, (r) => r.stopReason);
  const intents = results.map((r) => Number(r.finalPurchaseIntent || 0));
  const avgIntent = intents.length ? intents.reduce((a, b) => a + b, 0) / intents.length : 0;

  const reasonText = events.map((e) => e.reason || '');
  const offerMentions = reasonText.filter((x) => /offer|discount|deal/i.test(x)).length;
  const comboMentions = reasonText.filter((x) => /combo|bundle|starter kit|full kit/i.test(x)).length;
  const trustMentions = reasonText.filter((x) => /trust|genuine|authentic|fake|review/i.test(x)).length;
  const navigationMentions = reasonText.filter((x) => /navigation|search|find|overwhelm/i.test(x)).length;

  return {
    research_type: 'synthetic_shopper_simulation',
    warning: 'Synthetic research generates hypotheses. It is not actual customer behaviour and must be validated with real analytics, session recordings, customer conversations and orders.',
    personas: personas.length,
    events: events.length,
    funnel: {
      home_reached: uniquePersonaCount(events, (e) => e.page_type === 'home'),
      discovery_reached: uniquePersonaCount(events, (e) => ['collection', 'search'].includes(e.page_type)),
      product_reached: uniquePersonaCount(events, (e) => e.page_type === 'product'),
      cart_reached: uniquePersonaCount(events, (e) => e.page_type === 'cart'),
      add_to_cart_attempted: uniquePersonaCount(events, (e) => e.action === 'add_to_cart'),
      add_to_cart_succeeded: uniquePersonaCount(events, (e) => e.action === 'add_to_cart' && e.action_success),
    },
    product_interest: sortCounts(countBy(productTitles, (x) => x)).slice(0, 15),
    friction_tags: sortCounts(frictionCounts),
    stop_reasons: sortCounts(stopReasonCounts),
    qualitative_mentions: {
      price_or_value: reasonText.filter((x) => /price|expensive|budget|value/i.test(x)).length,
      offers: offerMentions,
      combos_or_bundles: comboMentions,
      trust_or_authenticity: trustMentions,
      navigation_or_search: navigationMentions,
      shipping_or_returns: reasonText.filter((x) => /shipping|delivery|dispatch|return/i.test(x)).length,
      sizing: reasonText.filter((x) => /size|fit/i.test(x)).length,
    },
    purchase_intent: {
      average: Math.round(avgIntent * 10) / 10,
      min: intents.length ? Math.min(...intents) : 0,
      max: intents.length ? Math.max(...intents) : 0,
      high_70_plus: intents.filter((x) => x >= 70).length,
      medium_40_69: intents.filter((x) => x >= 40 && x < 70).length,
      low_below_40: intents.filter((x) => x < 40).length,
    },
    recommended_experiments: recommendationsFromSignals(frictionCounts, events),
  };
}

function markdownTable(rows, headers) {
  if (!rows.length) return '_None observed in this run._';
  const header = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map((v) => String(v).replace(/\|/g, '\\|')).join(' | ')} |`).join('\n');
  return `${header}\n${body}`;
}

function buildReport(summary) {
  const s = summary;
  const experimentRows = s.recommended_experiments.map((x, i) => [i + 1, x.experiment, x.why, x.signal_score]);
  const frictionRows = s.friction_tags.slice(0, 15).map((x) => [x.name, x.count]);
  const productRows = s.product_interest.slice(0, 10).map((x) => [x.name, x.count]);
  const stopRows = s.stop_reasons.map((x) => [x.name, x.count]);

  return `# Indian Cricket Store — MiroFish Shopper Lab

> **Synthetic research only.** These are simulated shoppers, not real customers. Use this report to decide what to test. Do not treat it as proof of demand, willingness to pay, or conversion behaviour. Validate the strongest findings against real Shopify/GA4 data, session recordings, customer messages and actual orders.

## Run snapshot

- Personas: **${s.personas}**
- Logged steps: **${s.events}**
- Average final purchase intent: **${s.purchase_intent.average}/100**
- High intent (70+): **${s.purchase_intent.high_70_plus}**
- Medium intent (40–69): **${s.purchase_intent.medium_40_69}**
- Low intent (<40): **${s.purchase_intent.low_below_40}**

## Synthetic funnel

| Stage | Personas |
| --- | ---: |
| Home reached | ${s.funnel.home_reached} |
| Search / collection reached | ${s.funnel.discovery_reached} |
| Product reached | ${s.funnel.product_reached} |
| Add-to-cart attempted | ${s.funnel.add_to_cart_attempted} |
| Add-to-cart succeeded | ${s.funnel.add_to_cart_succeeded} |
| Cart reached | ${s.funnel.cart_reached} |

## Products that drew attention

${markdownTable(productRows, ['Product/page', 'Visits'])}

## Main friction signals

${markdownTable(frictionRows, ['Signal', 'Mentions'])}

## Qualitative themes

- Price/value: **${s.qualitative_mentions.price_or_value}**
- Offers/discounts: **${s.qualitative_mentions.offers}**
- Combos/bundles: **${s.qualitative_mentions.combos_or_bundles}**
- Trust/authenticity: **${s.qualitative_mentions.trust_or_authenticity}**
- Navigation/search: **${s.qualitative_mentions.navigation_or_search}**
- Shipping/returns: **${s.qualitative_mentions.shipping_or_returns}**
- Sizing/fit: **${s.qualitative_mentions.sizing}**

## Why sessions stopped

${markdownTable(stopRows, ['Reason', 'Personas'])}

## Top experiments to run next

${markdownTable(experimentRows, ['#', 'Experiment', 'Why', 'Synthetic signal score'])}

## How to use this

Treat repeated synthetic objections as **questions to validate**, not answers. The strongest next move is to run only a small number of controlled website experiments, then compare actual product views, search usage, add-to-cart rate, checkout initiation and completed orders. Keep changes that improve real behaviour; discard ideas that only the agents liked.
`;
}

function writeReportFiles({ outputDir, summary }) {
  fs.writeFileSync(`${outputDir}/summary.json`, JSON.stringify(summary, null, 2));
  fs.writeFileSync(`${outputDir}/report.md`, buildReport(summary));
}

module.exports = { buildSummary, buildReport, writeReportFiles };
