'use strict';

// Smoke test of the built preview page in headless Chromium: loads without
// errors, plays, switches mode, and a saved clip holds the engine's notes.
// Skipped where Playwright isn't installed (e.g. CI).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const E = require('../engine');

let chromium = null;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  chromium = null;
}

test('preview page plays, switches mode and saves the engine’s notes', { skip: !chromium && 'playwright not installed' }, async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('file://' + path.join(__dirname, '..', 'preview', 'organic-preview.html'));
    await page.click('#play');
    await page.waitForTimeout(1500);
    assert.match(await page.textContent('#pos'), /\d+ notes/);
    await page.click('#mode-irregular');
    await page.waitForTimeout(300);
    assert.match(await page.textContent('#grouping'), /Grouping/);
    await page.click('#play');
    const notes = await page.evaluate(() => window.__organicLab.clipEvents(4).notes);
    const ref = E.createEngine({ params: { mode: 'irregular' } });
    ref.reset(0);
    const expected = [];
    for (let b = 0; b < 16; b += 0.25) expected.push(...ref.generate(b, b + 0.25));
    assert.deepEqual(notes, expected);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
