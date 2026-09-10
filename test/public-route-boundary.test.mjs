import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import test from "node:test";
import { chromium } from "playwright";

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

test("prototype routes use labeled fixtures and the personal route stays fail-closed", async () => {
  await withPublicServer(async (baseUrl) => {
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    try {
      const page = await browser.newPage();
      for (const path of ["interview", "review", "retry", "related"]) {
        await page.goto(`${baseUrl}/#${path}`);
        const body = await page.locator("body").innerText();
        assert.equal(await page.locator('.prototype-bar').count(), 0);
        assert.match(body, /Prototype only|Demo · fictional sessions/);
        assert.doesNotMatch(body, /Records are not being collected\./);
      }
      await page.goto(`${baseUrl}/#sample`);
      await page.getByRole("button", { name: "Run sample tests", exact: true }).waitFor();
      assert.match(await page.locator("body").innerText(), /Fictional sample/);
      await page.goto(`${baseUrl}/#personal`);
      await page.getByRole("heading", { name: "Records are not being collected." }).waitFor();
      assert.doesNotMatch(await page.locator("body").innerText(), /Design prototype|Simulated result|Run prepared tests|Fictional saved attempt/);
    } finally {
      await browser.close();
    }
  });
});
