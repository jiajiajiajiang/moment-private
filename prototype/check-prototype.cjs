const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.MOMENT_CONFIG = {};' }));
  const targetUrl = process.env.MOMENT_TEST_URL || `file:///${path.resolve(__dirname, 'index.html').replace(/\\/g, '/')}`;
  await page.goto(targetUrl);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.resolve(__dirname, 'prototype-login.png'), fullPage: true });
  await page.evaluate(() => { location.hash = '#home'; });
  await page.reload();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.resolve(__dirname, 'prototype-mobile.png'), fullPage: true });
  await page.locator('[data-route="create"]').last().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.resolve(__dirname, 'prototype-create.png'), fullPage: true });
  await page.locator('#openLocationPicker').click();
  await page.waitForTimeout(800);
  if (process.env.MOMENT_TEST_URL) {
    await page.locator('#citySearchInput').fill('杭州');
    await page.locator('#citySearchForm button').click();
    await page.waitForSelector('#citySearchResults button');
    await page.locator('#citySearchResults button').first().click();
  }
  await page.screenshot({ path: path.resolve(__dirname, 'prototype-location.png'), fullPage: true });
  await page.locator('#closeLocationPicker').click();
  await page.evaluate(() => { location.hash = '#security'; });
  await page.reload();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.resolve(__dirname, 'prototype-security.png'), fullPage: true });
  console.log(JSON.stringify({ title: await page.title(), screens: await page.locator('[data-screen]').count(), errors }, null, 2));
  await browser.close();
})();
