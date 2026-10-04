'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  launchBrowser,
  createShopperPage,
  extractCandidates,
  clickCandidateInPage,
} = require('../src/browser');

test('pinned button candidate does not drift when DOM order changes', async (t) => {
  const browser = await launchBrowser({ headless: true });
  t.after(async () => { await browser.close().catch(() => {}); });
  const page = await createShopperPage(browser);
  await page.setContent(`
    <button id="alpha" onclick="window.__picked='alpha'">Alpha</button>
    <button id="beta" onclick="window.__picked='beta'">Beta</button>
  `);

  const candidates = await extractCandidates(page);
  const beta = candidates.find((c) => c.label === 'Beta');
  assert.ok(beta);

  await page.evaluate(() => {
    const inserted = document.createElement('button');
    inserted.textContent = 'Inserted before everything';
    document.body.prepend(inserted);
  });

  const result = await clickCandidateInPage(page, beta);
  assert.equal(result.clicked, true);
  assert.equal(await page.evaluate(() => window.__picked), 'beta');
  await page.browserContext().close();
});

test('missing pinned candidate fails closed instead of clicking a replacement', async (t) => {
  const browser = await launchBrowser({ headless: true });
  t.after(async () => { await browser.close().catch(() => {}); });
  const page = await createShopperPage(browser);
  await page.setContent('<button id="alpha">Alpha</button><button id="beta">Beta</button>');

  const candidates = await extractCandidates(page);
  const beta = candidates.find((c) => c.label === 'Beta');
  await page.evaluate(() => document.getElementById('beta').remove());

  const result = await clickCandidateInPage(page, beta);
  assert.equal(result.clicked, false);
  assert.equal(result.reason, 'candidate_pin_missing');
  await page.browserContext().close();
});
