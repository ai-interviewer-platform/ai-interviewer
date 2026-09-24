import { chromium } from "playwright";

// PLAYWRIGHT_CHANNEL selects a browser channel (for example `msedge`) and
// PLAYWRIGHT_EXECUTABLE_PATH a specific Chromium binary. Otherwise prefer Edge,
// then fall back to Playwright's installed Chromium for Linux/CI.
export async function launchBrowser(options = {}) {
  const channel = process.env.PLAYWRIGHT_CHANNEL;
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (executablePath) return chromium.launch({ executablePath, ...options });
  if (channel) return chromium.launch({ channel, ...options });
  try {
    return await chromium.launch({ channel: "msedge", ...options });
  } catch {
    return chromium.launch(options);
  }
}
