/**
 * Recon Mode: Opens a dealer locator page in a headed browser,
 * intercepts ALL network requests, and logs anything that looks like
 * dealer/store data. This helps you discover the hidden API endpoint.
 *
 * Usage: node recon.js <url> [zip_code]
 * Example: node recon.js https://www.stihlusa.com/en/dealers 30301
 */

import { chromium } from "playwright";

const url = process.argv[2];
const zip = process.argv[3] || "30301";

if (!url) {
  console.error("Usage: node recon.js <dealer-locator-url> [zip_code]");
  process.exit(1);
}

console.log(`\n🔍 RECON MODE`);
console.log(`URL: ${url}`);
console.log(`Test zip: ${zip}`);
console.log(`Intercepting all network requests...\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 720 },
});

const page = await context.newPage();

// Collect interesting requests
const apiCandidates = [];

page.on("response", async (response) => {
  const reqUrl = response.url();
  const status = response.status();
  const contentType = response.headers()["content-type"] || "";

  // Skip static assets
  if (
    reqUrl.match(
      /\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|webp)(\?|$)/i
    )
  )
    return;
  if (reqUrl.includes("google-analytics") || reqUrl.includes("gtag"))
    return;
  if (reqUrl.includes("googletagmanager") || reqUrl.includes("facebook"))
    return;
  if (reqUrl.includes("fonts.googleapis") || reqUrl.includes("fonts.gstatic"))
    return;

  // Log all API/JSON responses
  if (
    contentType.includes("json") ||
    reqUrl.includes("api") ||
    reqUrl.includes("dealer") ||
    reqUrl.includes("store") ||
    reqUrl.includes("locator") ||
    reqUrl.includes("location") ||
    reqUrl.includes("search") ||
    reqUrl.includes("find") ||
    reqUrl.includes("ajax") ||
    reqUrl.includes("wp-json")
  ) {
    let bodyPreview = "";
    try {
      const body = await response.text();
      bodyPreview = body.substring(0, 500);

      // Check if response contains location-like data
      const hasLocationData =
        body.includes("address") ||
        body.includes("latitude") ||
        body.includes("longitude") ||
        body.includes("lat") ||
        body.includes("lng") ||
        body.includes("phone") ||
        body.includes("dealer") ||
        body.includes("store") ||
        body.includes("city") ||
        body.includes("state") ||
        body.includes("zipCode") ||
        body.includes("zip_code");

      apiCandidates.push({
        url: reqUrl,
        method: response.request().method(),
        status,
        contentType,
        hasLocationData,
        bodySize: body.length,
        bodyPreview,
        postData: response.request().postData() || null,
        headers: response.request().headers(),
      });

      const marker = hasLocationData ? " ⭐ LIKELY DEALER API" : "";
      console.log(
        `[${status}] ${response.request().method()} ${reqUrl.substring(0, 120)}${marker}`
      );
      if (hasLocationData) {
        console.log(`  Content-Type: ${contentType}`);
        console.log(`  Body size: ${body.length} bytes`);
        console.log(`  Preview: ${bodyPreview.substring(0, 200)}...`);
        console.log();
      }
    } catch (e) {
      // Response body not available
    }
  }
});

// Navigate to the page
console.log("--- Loading page ---");
await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
console.log("--- Page loaded ---\n");

// Wait a moment for any lazy-loaded content
await page.waitForTimeout(2000);

// Try to find and interact with the search input
console.log("--- Attempting to search for zip code ---");

// Common selectors for dealer locator search inputs
const searchSelectors = [
  'input[placeholder*="zip" i]',
  'input[placeholder*="location" i]',
  'input[placeholder*="city" i]',
  'input[placeholder*="address" i]',
  'input[placeholder*="search" i]',
  'input[placeholder*="enter" i]',
  'input[name*="zip" i]',
  'input[name*="location" i]',
  'input[name*="search" i]',
  'input[name*="address" i]',
  'input[id*="zip" i]',
  'input[id*="location" i]',
  'input[id*="search" i]',
  'input[id*="dealer" i]',
  'input[id*="store" i]',
  'input[type="search"]',
  'input[type="text"]',
  ".dealer-locator input",
  ".store-locator input",
  "#dealer-search",
  "#store-search",
  "#location-search",
];

let found = false;
for (const selector of searchSelectors) {
  try {
    const input = await page.$(selector);
    if (input) {
      const isVisible = await input.isVisible();
      if (isVisible) {
        console.log(`Found input: ${selector}`);
        await input.click();
        await input.fill(zip);
        await page.waitForTimeout(500);

        // Try pressing Enter
        await input.press("Enter");
        console.log(`Entered zip "${zip}" and pressed Enter`);
        found = true;
        break;
      }
    }
  } catch (e) {
    // Continue trying
  }
}

if (!found) {
  console.log(
    "Could not find search input automatically. Listing all inputs on page:"
  );
  const inputs = await page.$$eval("input", (els) =>
    els.map((el) => ({
      type: el.type,
      name: el.name,
      id: el.id,
      placeholder: el.placeholder,
      className: el.className,
      visible: el.offsetParent !== null,
    }))
  );
  console.log(JSON.stringify(inputs, null, 2));
}

// Wait for API responses after search
console.log("\n--- Waiting for API responses ---");
await page.waitForTimeout(5000);

// Also try clicking any search/find buttons
const buttonSelectors = [
  'button[type="submit"]',
  'button:has-text("Search")',
  'button:has-text("Find")',
  'button:has-text("Go")',
  'button:has-text("Locate")',
  'input[type="submit"]',
  ".search-button",
  ".find-button",
];

if (found) {
  for (const selector of buttonSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn && (await btn.isVisible())) {
        await btn.click();
        console.log(`Clicked button: ${selector}`);
        await page.waitForTimeout(3000);
        break;
      }
    } catch (e) {
      // Continue
    }
  }
}

// Final wait for any remaining responses
await page.waitForTimeout(3000);

// Summary
console.log("\n\n========================================");
console.log("RECON SUMMARY");
console.log("========================================\n");

const locationApis = apiCandidates.filter((c) => c.hasLocationData);
if (locationApis.length > 0) {
  console.log(`Found ${locationApis.length} API endpoint(s) with location data:\n`);
  for (const api of locationApis) {
    console.log(`  METHOD: ${api.method}`);
    console.log(`  URL: ${api.url}`);
    console.log(`  Status: ${api.status}`);
    console.log(`  Content-Type: ${api.contentType}`);
    console.log(`  Body size: ${api.bodySize} bytes`);
    if (api.postData) {
      console.log(`  POST data: ${api.postData}`);
    }
    console.log(`  Request headers:`);
    for (const [k, v] of Object.entries(api.headers)) {
      if (!["accept-encoding", "accept-language", "user-agent", "sec-", "connection", "upgrade-insecure-requests"].some(skip => k.startsWith(skip))) {
        console.log(`    ${k}: ${v}`);
      }
    }
    console.log(`  Response preview:\n${api.bodyPreview}\n`);
    console.log("  ---");
  }
} else {
  console.log("No obvious dealer API endpoints found.");
  console.log(
    "The locator may use an iframe, require specific interaction, or load data differently."
  );
  console.log(`\nAll ${apiCandidates.length} intercepted requests:`);
  for (const api of apiCandidates) {
    console.log(`  [${api.status}] ${api.method} ${api.url.substring(0, 150)}`);
  }
}

await browser.close();
