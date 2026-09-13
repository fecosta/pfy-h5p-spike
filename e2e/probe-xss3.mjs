import { chromium } from '@playwright/test';
import fs from 'fs';
const uuid = fs.readFileSync('/tmp/xss_uuid.txt','utf-8').trim();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const fired = [];
  page.on('dialog', async d => { fired.push('dialog: '+d.message()); await d.dismiss(); });
  await page.exposeFunction('__xssBeacon', (w) => fired.push('beacon: '+w));
  await page.addInitScript(() => { window.alert = (m) => window.__xssBeacon('alert:'+m); });
  await page.goto(`http://localhost:8080/play/${uuid}`, {waitUntil:'networkidle'});
  await page.waitForTimeout(3500);
  const html = await page.locator('.h5p-content').innerHTML();
  console.log('payload executed:', fired.length ? fired : 'NO — nothing fired');
  console.log('script in DOM:', /<script/i.test(html), '| onerror in DOM:', /onerror/i.test(html));
  console.log('activity still renders:', html.length > 200, `(${html.length} bytes)`);
  console.log('answers rendered:', await page.locator('.h5p-answer').count());
} finally { await browser.close(); }
