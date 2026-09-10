import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { scenes } from './model.js';

const base = process.env.PROTOTYPE_URL;
if (!base) throw new Error('Set PROTOTYPE_URL to the URL printed by npm run dev.');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await mkdir('output/playwright', { recursive: true });
try {
  const issues = [];
  for (const [title, path] of scenes) {
    await page.goto(`${base}/#${path}`);
    await page.locator('h1').waitFor();
    assert.ok(await page.title(), title);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    for (const violation of result.violations) issues.push({ screen: title, id: violation.id, nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) });
    const name = title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
    await page.screenshot({ path: `output/playwright/${name}.png`, fullPage: true });
    console.log(`Rendered: ${title}`);
  }
  console.log('Accessibility findings:', JSON.stringify(issues, null, 2));
  assert.equal(issues.length, 0, 'Accessibility findings must be addressed.');

  await page.goto(`${base}/#sample`);
  await page.getByRole('button', { name: 'Run sample tests', exact: true }).click();
  assert.match(await page.locator('#test-body').innerText(), /Simulated result/);
  await page.getByRole('button', { name: 'Review this moment', exact: true }).click();
  await page.getByRole('button', { name: 'Retry from here', exact: true }).waitFor();
  await page.getByLabel('Saved checkpoint').selectOption('start');
  assert.match(await page.locator('#test-body').innerText(), /No run at this checkpoint/);
  await page.getByRole('button', { name: '04:26 · Inspect test-run evidence' }).click();
  assert.equal(await page.getByLabel('Saved checkpoint').inputValue(), 'run');
  await page.getByRole('button', { name: 'Retry from here', exact: true }).click();
  await page.getByRole('button', { name: 'Return immediately', exact: true }).click();
  await page.getByRole('button', { name: 'Run sample tests', exact: true }).click();
  assert.match(await page.locator('#test-body').innerText(), /Prepared cases pass/);
  await page.getByRole('button', { name: 'Finish retry', exact: true }).click();
  await page.getByRole('heading', { name: /A small change.*A different result/ }).waitFor();
  console.log('Passed: complete sample → evidence → retry → result journey');

  await page.goto(`${base}/#setup`);
  await page.getByRole('checkbox', { name: /Allow transcript/ }).uncheck();
  await page.getByRole('button', { name: 'Start interview preview' }).click();
  assert.equal(await page.locator('[name="consent"]').getAttribute('aria-invalid'), 'true');
  await page.getByRole('checkbox', { name: /Allow transcript/ }).check();
  await page.getByRole('button', { name: 'Start interview preview' }).click();
  await page.getByRole('button', { name: 'Ask for help', exact: true }).click();
  await page.getByRole('button', { name: 'Show the hint', exact: true }).click();
  assert.match(await page.locator('.workspace-footnote').innerText(), /Guidance used/);
  await page.getByLabel('Message the interviewer').fill('<script>not executed</script>');
  await page.getByRole('button', { name: 'Send preview message' }).click();
  assert.match(await page.locator('#messages').innerText(), /<script>not executed<\/script>/);
  await page.getByRole('button', { name: 'Save & exit' }).click();
  await page.locator('.session-row').first().waitFor();
  assert.match(await page.locator('.session-row').first().innerText(), /Draft saved/);
  await page.reload();
  assert.match(await page.locator('.session-row').first().innerText(), /Draft saved/);
  console.log('Passed: storage choice, requested help, escaped local message, save and return');

  await page.goto(`${base}/#roadmap?topic=sets&view=list`);
  await page.getByRole('link', { name: /Seen-value tracking/ }).click();
  await page.getByRole('dialog', { name: 'Seen-value tracking' }).waitFor();
  await page.getByRole('link', { name: 'Set up interview', exact: true }).click();
  await page.getByRole('link', { name: 'Back to roadmap' }).click();
  assert.match(page.url(), /topic=sets&view=list/);
  await page.getByRole('dialog', { name: 'Seen-value tracking' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForURL(/return=seen/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'leaf-seen');
  await page.getByRole('link', { name: 'Close topic detail' }).click();
  await page.waitForURL(/return=sets/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'topic-sets');
  for (const [path, button, expected] of [
    ['interview?state=runner', 'Retry prepared run', '#test-body'],
    ['interview?state=offline', 'Continue in text', '#message'],
    ['review?state=error', 'Retry review preview', '.finding-summary'],
    ['review?state=pending', 'Show ready review', '.finding-summary'],
  ]) {
    await page.goto(`${base}/#${path}`);
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.locator(expected).waitFor();
    assert.equal(new URL(page.url()).hash.includes('state='), false);
  }
  await page.goto(`${base}/#review?state=audio`);
  await page.getByRole('button', { name: 'Play replay preview' }).click();
  await page.getByLabel('Example audio position').fill('200');
  assert.equal(await page.getByLabel('Saved checkpoint').inputValue(), 'run');
  await page.getByLabel('Saved checkpoint').selectOption('start');
  assert.equal(await page.getByLabel('Example audio position').inputValue(), '200');
  console.log('Passed: map return context, error recovery, and independent playback controls');

  await page.goto(`${base}/#review`);
  await page.getByRole('button', { name: 'Disagree with this feedback' }).click();
  await page.getByRole('button', { name: 'Mark example disputed' }).click();
  assert.match(await page.locator('.next-focus').innerText(), /Finding disputed/);
  assert.equal(await page.getByRole('button', { name: 'Retry from here', exact: true }).count(), 0);
  await page.goto(`${base}/#system`);
  await page.getByRole('button', { name: 'Open disclosure' }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#dialog').evaluate((el) => el.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Open disclosure');
  console.log('Passed: dispute suppression and keyboard dialog focus restoration');

  const action = page.getByRole('button', { name: 'Primary action', exact: true });
  await action.hover();
  await page.mouse.down();
  await action.evaluate(async (el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
  assert.equal(await action.evaluate((el) => getComputedStyle(el).transform), 'matrix(0.96, 0, 0, 0.96, 0, 0)');
  await page.screenshot({ path: 'output/playwright/motion-pressed.png', fullPage: true });
  await page.mouse.up();
  await page.keyboard.press('Tab');
  assert.equal(await action.evaluate((el) => getComputedStyle(el).transitionDuration), '0s');
  await page.goto(`${base}/#preferences`);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export example record' }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'interview-trainer-example.json');
  await page.getByRole('button', { name: 'Delete demo sessions', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete demo sessions?' }).getByRole('button', { name: 'Delete demo sessions', exact: true }).click();
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  await page.getByRole('heading', { name: 'Your first session starts here' }).waitFor();
  console.log('Passed: pointer press, immediate keyboard feedback, export, and recoverable demo deletion');

  for (const width of [768, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [, path] of scenes) {
      await page.goto(`${base}/#${path}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false, `Page overflow at ${width}: ${path}`);
    }
    await page.goto(`${base}/#review`);
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    assert.equal(await page.locator('.code-scroll').isVisible(), true);
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    assert.equal(await page.locator('.conversation-pane').isVisible(), true);
    await page.screenshot({ path: `output/playwright/review-narrow-${width}.png`, fullPage: true });
    console.log(`Passed: all scenes reflow at ${width}px and workspace panes remain accessible`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${base}/#system`);
  const motion = await page.getByRole('button', { name: 'Primary action' }).evaluate((el) => getComputedStyle(el).transitionDuration);
  assert.equal(motion, '0s');
  assert.deepEqual(errors, []);
  console.log('Passed: reduced motion and no browser exceptions');
} finally { await browser.close(); }
