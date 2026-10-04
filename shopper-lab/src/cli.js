#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('./browser');
const { generatePersonas } = require('./personas');
const { runAgent } = require('./agent');
const { buildSummary, writeReportFiles } = require('./report');

function parseArgs(argv) {
  const opts = {
    url: 'https://www.indiancricketstore.com',
    agents: 6,
    steps: 8,
    headless: true,
    output: null,
    seed: Date.now(),
    noLlm: false,
    heuristic: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--url') opts.url = next();
    else if (arg === '--agents') opts.agents = Number(next());
    else if (arg === '--steps') opts.steps = Number(next());
    else if (arg === '--output') opts.output = next();
    else if (arg === '--seed') opts.seed = Number(next());
    else if (arg === '--no-llm') opts.noLlm = true;
    else if (arg === '--heuristic') opts.heuristic = true;
    else if (arg === '--headless') {
      const maybe = argv[i + 1];
      if (maybe && !maybe.startsWith('--')) {
        i += 1;
        opts.headless = !['false', '0', 'no'].includes(String(maybe).toLowerCase());
      } else {
        opts.headless = true;
      }
    } else if (arg === '--headed') opts.headless = false;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(opts.agents) || opts.agents < 1 || opts.agents > 40) {
    throw new Error('--agents must be an integer from 1 to 40');
  }
  if (!Number.isInteger(opts.steps) || opts.steps < 1 || opts.steps > 30) {
    throw new Error('--steps must be an integer from 1 to 30');
  }
  if (!Number.isFinite(opts.seed)) throw new Error('--seed must be numeric');

  const u = new URL(opts.url);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('--url must be http(s)');
  return opts;
}

function usage() {
  return `MiroFish Indian Cricket Store Shopper Lab

Usage:
  npm run simulate -- --url https://www.indiancricketstore.com --agents 6 --steps 8

Options:
  --agents N       Number of synthetic shoppers (1-40, default 6)
  --steps N        Maximum actions per shopper (1-30, default 8)
  --seed N         Reproducible persona cohort seed
  --output PATH    Output directory (default runs/<timestamp>)
  --headless BOOL  Browser headless mode, default true
  --headed         Show browser windows
  --no-llm         Deterministic safe smoke mode; never adds to cart
  --heuristic      Persona/budget/brand fallback; may add to cart, never checkout
`;
}

function makeRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function checkSite(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'MiroFishShopperLab/1.0 preflight' },
  });
  return { status: response.status, finalUrl: response.url };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(usage());
    return;
  }

  const runId = makeRunId();
  const outputDir = path.resolve(opts.output || path.join(__dirname, '..', 'runs', runId));
  const screenshotsDir = path.join(outputDir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const eventsPath = path.join(outputDir, 'events.jsonl');
  fs.writeFileSync(eventsPath, '');

  const personas = generatePersonas(opts.agents, opts.seed);
  fs.writeFileSync(path.join(outputDir, 'personas.json'), JSON.stringify(personas, null, 2));

  process.stdout.write(`Preflight: ${opts.url}\n`);
  const preflight = await checkSite(opts.url);
  if (preflight.status < 200 || preflight.status >= 400) {
    throw new Error(`Store preflight returned HTTP ${preflight.status}`);
  }
  process.stdout.write(`Store HTTP ${preflight.status}: ${preflight.finalUrl}\n`);

  const events = [];
  const results = [];
  const logEvent = (event) => {
    events.push(event);
    fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n');
  };

  const browser = await launchBrowser({ headless: opts.headless });
  try {
    for (let i = 0; i < personas.length; i++) {
      const persona = personas[i];
      process.stdout.write(`Shopper ${i + 1}/${personas.length}: ${persona.name}\n`);
      try {
        const result = await runAgent({
          browser,
          persona,
          startUrl: opts.url,
          maxSteps: opts.steps,
          noLlm: opts.noLlm,
          heuristic: opts.heuristic,
          screenshotsDir,
          logEvent,
          claudeOptions: {},
        });
        results.push(result);
      } catch (err) {
        logEvent({
          timestamp: new Date().toISOString(),
          persona_id: persona.user_id,
          step: -1,
          url: opts.url,
          page_title: null,
          page_type: 'error',
          visible_text_summary: null,
          products: [],
          action: 'stop',
          action_success: false,
          reason: `Agent runner failed safely: ${err.message}`,
          purchase_intent: 0,
          friction_tags: ['agent_error'],
        });
        results.push({
          personaId: persona.user_id,
          steps: 0,
          stopReason: 'agent_error',
          finalPurchaseIntent: 0,
          error: err.message,
        });
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const summary = buildSummary({ personas, events, results });
  summary.run = {
    id: runId,
    started_url: opts.url,
    final_preflight_url: preflight.finalUrl,
    site_http_status: preflight.status,
    seed: opts.seed,
    agents_requested: opts.agents,
    max_steps: opts.steps,
    no_llm: opts.noLlm,
    heuristic: opts.heuristic,
    headless: opts.headless,
  };
  summary.results = results;

  writeReportFiles({ outputDir, summary });

  process.stdout.write(`\nRun complete: ${outputDir}\n`);
  process.stdout.write(`Report: ${path.join(outputDir, 'report.md')}\n`);
  process.stdout.write(`Synthetic research only. Validate findings with real customer evidence.\n`);
}

main().catch((err) => {
  process.stderr.write(`Shopper Lab failed: ${err.stack || err.message}\n`);
  process.exitCode = 1;
});
