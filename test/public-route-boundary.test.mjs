import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import test from "node:test";
import { launchBrowser } from "./browser/launch.mjs";

const publicRoot = resolve(import.meta.dirname, "../public");
const contentType = { ".css": "text/css", ".js": "text/javascript", ".html": "text/html" };

async function withPublicServer(run) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/api/personal-availability") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ collectionEnabled: false }));
      return;
    }
    const file = resolve(publicRoot, pathname === "/" ? "index.html" : `.${pathname}`);
    if (!file.startsWith(`${publicRoot}${sep}`) || !contentType[extname(file)]) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": contentType[extname(file)] });
    response.end(await readFile(file));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
}

test("sample routes use labeled fixtures and the personal route stays fail-closed", async () => {
  await withPublicServer(async (baseUrl) => {
    const browser = await launchBrowser({ headless: true });
    try {
      const page = await browser.newPage();
      for (const path of ["interview", "review", "retry", "related"]) {
        await page.goto(`${baseUrl}/#${path}`);
        const body = await page.locator("body").innerText();
        assert.equal(await page.locator('.prototype-bar').count(), 0);
        assert.match(await page.locator(".sample-banner").innerText(), /fictional data/);
        assert.equal(await page.locator(".page-footer").count(), 0);
        assert.doesNotMatch(body, /Records are not being collected\./);
      }
      await page.goto(`${baseUrl}/#sample`);
      await page.getByRole("button", { name: "Run sample tests", exact: true }).waitFor();
      assert.match(await page.locator("body").innerText(), /Guided sample · not scored/);
      // Signed out, the primary navigation and every interview setup link open the real app.
      for (const label of ["Roadmap", "Sessions"]) assert.match(await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: label }).getAttribute("href"), /^#personal\?page=/);
      await page.goto(`${baseUrl}/#setup?problem=tags`);
      await page.waitForURL(/#personal\?page=catalog$/);
      await page.goto(`${baseUrl}/#landing`);
      await page.locator(".landing").waitFor();
      assert.equal(await page.locator(".sample-banner").count(), 0);
      await page.goto(`${baseUrl}/#no-such-page`);
      await page.waitForURL(/#landing$/);
      await page.goto(`${baseUrl}/#welcome`);
      await page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Sign in" }).click();
      assert.equal(new URL(page.url()).hash, "#personal");
      await page.getByRole("heading", { name: "Records are not being collected." }).waitFor();
      assert.doesNotMatch(await page.locator("body").innerText(), /Design prototype|Simulated result|Run prepared tests|Fictional saved attempt/);
    } finally {
      await browser.close();
    }
  });
});
