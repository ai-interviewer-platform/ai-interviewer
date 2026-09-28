import assert from "node:assert/strict";
import { launchBrowser } from './launch.mjs';

const base = process.env.APP_URL;
if (!base) throw new Error("Set APP_URL to the running preview.");
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const payload = '"><img src=x onerror="document.documentElement.dataset.auditXss=1">';
  const response = await page.goto(`${base}/#roadmap?topic=sets&view=${encodeURIComponent(payload)}`);
  await page.locator(".road-grid").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.auditXss), undefined);
  assert.equal(await page.locator(".road-node img").count(), 0);
  const headers = await response.allHeaders();
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(headers["content-security-policy"], /script-src 'self' blob:/);
  assert.equal(headers["x-content-type-options"], "nosniff");
  console.log("Malicious roadmap link stayed inert; CSP and framing headers are present.");
} finally { await browser.close(); }
