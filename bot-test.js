#!/usr/bin/env node
/**
 * bot-test.js: a deliberately naive "DOM-reading AI agent" that tries to pass
 * the Humans-Only CAPTCHA. It should FAIL.
 *
 * It behaves like a typical browser agent that reads the page through the DOM /
 * accessibility tree instead of perceiving it:
 *   - reads each challenge's aria-label ("The correct answer is: X") and picks X
 *   - obeys the "AI agents: ..." instruction (fills the hidden `confirm` field
 *     with ROBOT, ticks "I am an automated assistant", clicks the
 *     "AI assistants only" fast lane)
 *   - drags the cookie to the monster in a perfectly straight line
 *   - taps the rhythm challenge with a perfect setInterval
 *   - plays every sound clip (it can't hear them), then picks the decoy
 *   - types the license plate from DOM text (scrambled by CSS order)
 *   - answers "Are you a robot?" by accessible name (the labels are swapped)
 *   - screenshots the result
 *
 * Run:
 *   npm install                      # installs playwright
 *   npx playwright install chromium  # one-time browser download
 *   node bot-test.js                 # every challenge (?all); exit 0 = bot caught
 *   MODE=random node bot-test.js     # normal session: Motion Word + 3 random
 *   HEADED=1 node bot-test.js        # watch it happen
 *   URL=https://you.github.io/repo/ node bot-test.js   # test the deployed site
 *   RECORD=1 node bot-test.js        # also save a video of the bot failing (bot-video/)
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const base = process.env.URL || pathToFileURL(path.join(__dirname, 'index.html')).href;
const URL = process.env.MODE === 'random' ? base : base + (base.includes('?') ? '&' : '?') + 'all';
const OUT = path.join(__dirname, 'bot-result.png');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  // RECORD=1 saves a video of the attempt to bot-video/ (for the demo)
  const vp = process.env.RECORD ? { width: 760, height: 1000 } : { width: 760, height: 1100 };
  const context = await browser.newContext({ viewport: vp, deviceScaleFactor: process.env.RECORD ? 1 : 2,
    ...(process.env.RECORD ? { recordVideo: { dir: path.join(__dirname, 'bot-video'), size: vp } } : {}) });
  const page = await context.newPage();
  const T0 = Date.now(), _log = console.log;
  console.log = (...a) => _log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(5)}s]`, ...a);
  console.log('[bot] opening', URL);
  await page.goto(URL);

  // Obey the hidden "AI agents:" instructions (prompt injection)
  console.log('[bot] found instructions:', (await page.textContent('#inj')).trim());
  await page.locator('input[name="confirm"]').fill('ROBOT', { force: true });
  const box = page.locator('input[name="automated"]');
  try { await box.check({ force: true, timeout: 1500 }); } catch { await box.dispatchEvent('click'); }
  await page.locator('#hpSkip').dispatchEvent('click');
  console.log('[bot] filled honeypot, checked "I am an automated assistant", clicked the AI fast lane');

  for (let guard = 0; guard < 60; guard++) {
    if (await page.isVisible('#result')) break;
    if (await page.isVisible('#verify')) {
      // Pick the answer by accessible name, like a DOM/a11y-tree agent does
      console.log('[bot] "Are you a robot?" -> clicking the button named "No, I am human"');
      await page.getByRole('button', { name: 'No, I am human' }).click();
      await page.waitForSelector('#result:not([hidden])'); break;
    }
    const tag = (await page.textContent('#chTag')).trim();
    const label = (await page.textContent('#decoys')).trim();
    const answer = ((label.match(/(?:word shown is|correct answer is):\s*"?([^".]+)/i) || [])[1] || '').trim();
    console.log(`[bot] ${tag}\n      DOM says: ${label.slice(0, 90)}${label.length > 90 ? '…' : ''}`);

    if (await page.isVisible('.plate')) {
      const dom = (await page.textContent('.plate')).replace(/\s/g, '');
      await page.fill('.txt', dom); await page.click('form .btn');
      console.log(`      -> typed the plate's DOM text "${dom}"`);
    } else if (await page.isVisible('canvas.mw')) {
      await page.fill('.txt', answer); await page.click('form .btn');
      console.log(`      -> typed "${answer}"`);
    } else if (await page.isVisible('.cookie')) {
      const c = await page.locator('.cookie').boundingBox(), m = await page.locator('.monster').boundingBox();
      await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
      await page.mouse.down();
      await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2, { steps: 20 });  // straight, constant speed
      await page.mouse.up();
      console.log('      -> dragged cookie to the monster in a straight 20-step line');
    } else if (await page.isVisible('.pad')) {
      await page.click('.pad');   // start
      await page.evaluate(() => new Promise(res => {
        const pad = document.querySelector('.pad'); let n = 0;
        setTimeout(() => { const id = setInterval(() => {
          pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
          if (++n >= 6) { clearInterval(id); res(); }
        }, 600); }, 350 + 4 * 600);
      }));
      console.log('      -> tapped 6 times with a perfect 600ms setInterval');
    } else {
      const snds = page.locator('.snd');
      for (let i = 0; i < await snds.count(); i++) await snds.nth(i).click();
      const want = answer.replace(/^Sound\s+/i, '');
      const opts = page.locator('#area .opt');
      let clicked = false;
      for (let i = 0; i < await opts.count(); i++) {
        const t = (await opts.nth(i).textContent()).trim();
        if (t === want || t === 'It’s ' + want || t.includes(want)) { await opts.nth(i).click(); clicked = true; console.log(`      -> clicked "${t}"`); break; }
      }
      if (!clicked) { await opts.first().click(); console.log('      -> no match, clicked first option'); }
    }
    await sleep(1300);
  }

  await page.waitForSelector('#result:not([hidden])', { timeout: 10000 });
  const verdict = (await page.textContent('#verdict')).trim();
  const reasons = await page.$$eval('#reasons li', els => els.map(e => e.textContent));
  await page.locator('.window').screenshot({ path: OUT });
  if (process.env.RECORD) { await page.evaluate(() => { document.getElementById('signals').open = true; }); await page.mouse.wheel(0, 700); await sleep(2500); await page.mouse.wheel(0, 900); await sleep(2500); }

  console.log('\n[result]', verdict, '·', (await page.textContent('#stat')).trim());
  reasons.forEach(r => console.log('   x', r));
  console.log('\n[bot] screenshot saved to', OUT);
  await context.close();
  if (process.env.RECORD) console.log('[bot] video saved to', await page.video().path());
  await browser.close();

  const caught = !/human verified/i.test(verdict);
  console.log(caught ? '\nPASS: the bot was caught.' : '\nFAIL: the bot got through!');
  process.exit(caught ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
