# Indian Cricket Store Shopper Lab

This is a contained ecommerce-research extension for the MiroFish repository.

It creates MiroFish-style Indian cricket shoppers, opens the live Indian Cricket Store in a mobile browser, lets each synthetic shopper browse/search/open products and optionally add to cart, and then produces a structured research report.

It is deliberately separate from the existing MiroFish backend/frontend. It does **not** modify Shopify products, prices, theme settings, DNS or orders.

## Safety

The browser layer hard-blocks:

- checkout and payment URLs
- customer login and registration
- wallets, Shop Pay and accelerated checkout
- common Google, Meta, TikTok and Shopify analytics/beacon endpoints

The model cannot execute arbitrary JavaScript or choose arbitrary URLs/selectors. It can only choose from a finite action set and numeric candidates extracted by the runner.

A simulation user-agent marker is added: `MiroFishShopperLab/1.0`.

## Requirements

- Node.js 20+ (Node 22 recommended)
- Google Chrome or Puppeteer's bundled browser
- For Claude mode: Claude Code CLI installed and already authenticated
- For FreeLLM mode on this Mac: FreeLLMAPI running locally
- No OpenAI or Anthropic API key is required by this shopper lab

## Install

```bash
cd shopper-lab
npm install
```

On this Mac the runner automatically uses `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` when present. You can also set:

```bash
export PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
```

## Safe smoke test

This mode does not call Claude and will never add to cart:

```bash
npm run smoke
```

Equivalent:

```bash
npm run simulate -- --url https://www.indiancricketstore.com --agents 1 --steps 2 --no-llm
```

## Synthetic shopper run

Claude Code mode:

```bash
npm run simulate -- --url https://www.indiancricketstore.com --agents 6 --steps 8
```

FreeLLM mode:

```bash
MIROFISH_FREE_LLM_MODEL='gemma4:31b' npm run simulate -- --url https://www.indiancricketstore.com --agents 12 --steps 5 --free-llm
```

`--free-llm` uses the local OpenAI-compatible FreeLLMAPI router. On this Mac the runner reads the local FreeLLM unified key at runtime; it does not print or commit the key. On another machine or in cloud, set `MIROFISH_FREE_LLM_API_KEY` and `MIROFISH_FREE_LLM_BASE_URL` explicitly.

Useful options:

```text
--agents N       1-40 shoppers
--steps N        1-30 actions per shopper
--seed N         reproducible persona cohort
--output PATH    custom output folder
--headless false show Chrome windows
--no-llm         deterministic smoke mode
--free-llm       use local FreeLLMAPI for shopper reasoning
```

Start small. Each shopper can make several model calls. FreeLLM mode has failover for transient rate limits, timeouts and malformed outputs. `gemma4:31b` has been the most stable fast primary route on the current Mac setup.

## Outputs

Each run writes:

```text
runs/<run-id>/
  personas.json
  events.jsonl
  summary.json
  report.md
  screenshots/
```

The report covers:

- synthetic funnel stages reached
- products/pages that attracted attention
- price/value objections
- missing offers or bundle requests
- trust/authenticity issues
- navigation/search friction
- shipping/returns and sizing concerns
- purchase-intent distribution
- ranked website experiments

## What this can and cannot tell you

### It can help with

- finding plausible objections before spending heavily on ads
- stress-testing a full-price proposition against different buyer types
- identifying where mobile navigation or product information may confuse shoppers
- generating pricing, offer, combo, trust and merchandising hypotheses
- prioritising a small number of experiments

### It cannot tell you

- your real conversion rate
- your real CAC
- whether a price will actually maximise profit
- how many real customers want a combo or discount
- whether a simulated objection is common in the market
- what real shoppers do when money is actually at stake

Synthetic shoppers are **hypothesis generation, not customer evidence**. Validate the strongest findings against real Shopify/GA4 data, session recordings, real search terms, abandoned carts, customer messages and completed orders.

## Recommended research loop

1. Run a small synthetic cohort on the current full-price site.
2. Identify repeated friction themes.
3. Pick one or two changes only.
4. Measure real behaviour before and after.
5. Keep changes that improve real add-to-cart, checkout and order performance.
6. Feed the real evidence back into future simulations.

That prevents the store from scrambling through random discounts and redesigns based only on AI opinions.

## Cloud deployment

The current build supports both the locally authenticated Claude Code CLI and the local FreeLLMAPI router.

A public/cloud deployment should not copy Claude desktop subscription credentials into Cloud Run. FreeLLM can be used in cloud only with separately authorised provider credentials; the Mac-local FreeLLM unified key is deliberately not committed to Git.

The safe cloud options are:

- keep the simulation runner on the authorised Mac and publish only reports elsewhere, or
- deploy with separately authorised FreeLLM/provider credentials supplied as cloud secrets.

The shopper lab does not need to be embedded into the public Shopify storefront to test it. Keeping the research runner separate is safer and avoids exposing an internal simulation tool to customers.
