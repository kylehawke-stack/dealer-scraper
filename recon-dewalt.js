/**
 * Focused recon for DeWalt - uses stealth approach to bypass bot detection
 */
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
  ],
});

const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 720 },
  locale: "en-US",
});

// Hide webdriver
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => false });
  // Override headless indicators
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  window.chrome = { runtime: {} };
});

const page = await context.newPage();

// Intercept ALL requests to find the dealer API
page.on("request", (request) => {
  const url = request.url();
  if (
    url.includes("location") ||
    url.includes("retailer") ||
    url.includes("dealer") ||
    url.includes("store") ||
    url.includes("apprunner") ||
    url.includes("sbdinc")
  ) {
    console.log(`\n=== REQUEST ===`);
    console.log(`METHOD: ${request.method()}`);
    console.log(`URL: ${url}`);
    console.log(`POST: ${request.postData() || "none"}`);
    const headers = request.headers();
    console.log("HEADERS:");
    for (const [k, v] of Object.entries(headers)) {
      if (!["sec-ch-ua", "sec-fetch", "sec-ch-ua-mobile", "sec-ch-ua-platform", "accept-encoding", "accept-language", "connection", "upgrade-insecure-requests"].some(s => k.startsWith(s))) {
        // Truncate long values (like JWTs)
        const display = v.length > 100 ? v.substring(0, 100) + "..." : v;
        console.log(`  ${k}: ${display}`);
      }
    }
  }
});

page.on("response", async (response) => {
  const url = response.url();
  if (url.includes("apprunner") || url.includes("location") && url.includes("json")) {
    console.log(`\n=== RESPONSE ===`);
    console.log(`STATUS: ${response.status()}`);
    console.log(`URL: ${url}`);
    try {
      const body = await response.text();
      console.log(`SIZE: ${body.length}`);
      console.log(`PREVIEW: ${body.substring(0, 500)}`);
    } catch (e) {
      console.log(`Body error: ${e.message}`);
    }
  }
});

console.log("Loading DeWalt retailer finder...");
try {
  await page.goto("https://www.dewalt.com/find-retailer", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  console.log("Page loaded.");
} catch (e) {
  console.log(`Page load error: ${e.message}`);
  // Continue anyway — we may have captured some requests
}

await page.waitForTimeout(5000);

// Try to find and use the search
console.log("\nLooking for search input...");
const inputs = await page.$$eval("input", (els) =>
  els.map((e) => ({
    type: e.type,
    name: e.name,
    id: e.id,
    placeholder: e.placeholder,
    visible: e.offsetParent !== null,
  })).filter(e => e.visible)
);
console.log("Visible inputs:", JSON.stringify(inputs, null, 2));

// Try entering a zip code
for (const selector of [
  'input[placeholder*="zip" i]',
  'input[placeholder*="city" i]',
  'input[placeholder*="location" i]',
  'input[name*="location" i]',
  'input[name*="search" i]',
  'input[id*="retailer" i]',
  'input[type="text"]',
  'input[type="search"]',
]) {
  try {
    const input = await page.$(selector);
    if (input && await input.isVisible()) {
      console.log(`\nFound input: ${selector}`);
      await input.click();
      await input.fill("30301");
      await page.waitForTimeout(500);
      await input.press("Enter");
      console.log("Entered zip and pressed Enter");
      break;
    }
  } catch (e) {}
}

await page.waitForTimeout(8000);

// Also extract drupalSettings
try {
  const settings = await page.evaluate(() => {
    const s = window.drupalSettings;
    if (s?.sbd_retailer_finder) return s.sbd_retailer_finder;
    if (s) return Object.keys(s);
    return null;
  });
  if (settings) {
    console.log("\n=== DRUPAL SETTINGS ===");
    console.log(JSON.stringify(settings, null, 2).substring(0, 2000));
  }
} catch (e) {
  console.log("No drupalSettings found");
}

console.log("\nDone.");
await browser.close();
