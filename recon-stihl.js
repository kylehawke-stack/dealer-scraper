/**
 * Focused recon for STIHL - captures the full API request details
 */
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 720 },
});

const page = await context.newPage();

page.on("request", async (request) => {
  const url = request.url();
  if (url.includes("dealerdatahub") || url.includes("dealer")) {
    if (url.includes("adobeioruntime") || url.includes("stihl")) {
      console.log("\n=== DEALER API REQUEST ===");
      console.log(`METHOD: ${request.method()}`);
      console.log(`FULL URL: ${url}`);
      console.log(`POST DATA: ${request.postData() || "none"}`);
      console.log("HEADERS:");
      const headers = request.headers();
      for (const [k, v] of Object.entries(headers)) {
        console.log(`  ${k}: ${v}`);
      }
    }
  }
});

page.on("response", async (response) => {
  const url = response.url();
  if (url.includes("dealerdatahub")) {
    console.log("\n=== DEALER API RESPONSE ===");
    console.log(`STATUS: ${response.status()}`);
    console.log(`URL: ${url}`);
    try {
      const body = await response.text();
      console.log(`BODY SIZE: ${body.length}`);
      // Parse and show structure
      const data = JSON.parse(body);
      console.log(`DEALERS COUNT: ${data.dealers?.length || 0}`);
      if (data.dealers?.length > 0) {
        const d = data.dealers[0];
        console.log(`\nFIRST DEALER KEYS: ${Object.keys(d).join(", ")}`);
        console.log(`FIRST DEALER SAMPLE: ${JSON.stringify(d, null, 2).substring(0, 1000)}`);
      }
      if (data.paginginfo) {
        console.log(`PAGING INFO: ${JSON.stringify(data.paginginfo)}`);
      }
      console.log(`\nFULL RESPONSE (first 2000 chars): ${body.substring(0, 2000)}`);
    } catch (e) {
      console.log(`Error reading body: ${e.message}`);
    }
  }
});

console.log("Loading STIHL dealer page...");
await page.goto("https://www.stihlusa.com/en/dealers", {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});

// Wait for initial load
await page.waitForTimeout(5000);

// Try to search for a zip code
console.log("\nSearching for zip 30301...");
const input = await page.$('input[type="text"], input[type="search"], input[placeholder*="zip" i], input[placeholder*="location" i], input[placeholder*="city" i]');
if (input) {
  await input.click();
  await input.fill("30301");
  await page.waitForTimeout(1000);
  await input.press("Enter");
  console.log("Entered zip and pressed Enter");
} else {
  console.log("No input found, trying to find all inputs...");
  const inputs = await page.$$eval("input", els => els.map(e => ({
    type: e.type, name: e.name, id: e.id, placeholder: e.placeholder, visible: e.offsetParent !== null
  })));
  console.log(JSON.stringify(inputs, null, 2));
}

// Wait for API response
await page.waitForTimeout(8000);

console.log("\nDone.");
await browser.close();
