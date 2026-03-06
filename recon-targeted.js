/**
 * Targeted recon that dismisses cookie consent banners before searching.
 * Usage: node recon-targeted.js <url> [zip]
 */
import { chromium } from "playwright";

const url = process.argv[2];
const zip = process.argv[3] || "30301";

if (!url) {
  console.error("Usage: node recon-targeted.js <url> [zip]");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 720 },
});

await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => false });
});

const page = await context.newPage();

// Capture all API requests with full details
page.on("request", (req) => {
  const u = req.url();
  if (u.includes(".css") || u.includes(".png") || u.includes(".jpg") || u.includes(".svg") || u.includes(".woff") || u.includes("google-analytics") || u.includes("googletagmanager") || u.includes("maps.googleapis.com/maps/vt")) return;

  const ct = req.headers()["content-type"] || "";
  if (u.includes("dealer") || u.includes("store") || u.includes("locator") || u.includes("location") || u.includes("search") || u.includes("api") || ct.includes("json")) {
    // Skip known non-dealer endpoints
    if (u.includes("cookie") || u.includes("onetrust") || u.includes("consent") || u.includes("analytics") || u.includes("gtm") || u.includes("recaptcha")) return;

    console.log(`\n>>> ${req.method()} ${u}`);
    if (req.postData()) console.log(`    POST: ${req.postData().substring(0, 500)}`);
    const h = req.headers();
    for (const [k, v] of Object.entries(h)) {
      if (k.includes("api-key") || k.includes("authorization") || k.includes("x-api") || k.includes("ocp-apim")) {
        console.log(`    ${k}: ${v}`);
      }
    }
  }
});

page.on("response", async (res) => {
  const u = res.url();
  const ct = res.headers()["content-type"] || "";
  if (!ct.includes("json")) return;
  if (u.includes("cookie") || u.includes("onetrust") || u.includes("consent") || u.includes("analytics")) return;

  if (u.includes("dealer") || u.includes("store") || u.includes("locator") || u.includes("location") || u.includes("search")) {
    try {
      const body = await res.text();
      if (body.includes("address") || body.includes("latitude") || body.includes("phone") || body.includes("dealer") || body.includes("city")) {
        console.log(`\n<<< ${res.status()} ${u}`);
        console.log(`    Size: ${body.length} bytes`);
        console.log(`    Preview: ${body.substring(0, 400)}`);
      }
    } catch (e) {}
  }
});

console.log(`Loading: ${url}`);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3000);

// Dismiss cookie consent banners
const cookieSelectors = [
  "#onetrust-accept-btn-handler",
  ".onetrust-close-btn-handler",
  'button:has-text("Accept")',
  'button:has-text("Accept All")',
  'button:has-text("I Accept")',
  'button:has-text("OK")',
  'button:has-text("Got it")',
  'button:has-text("Agree")',
  ".cc-btn.cc-dismiss",
  "#cookie-accept",
  ".cookie-consent-accept",
];

for (const sel of cookieSelectors) {
  try {
    const btn = await page.$(sel);
    if (btn && await btn.isVisible()) {
      await btn.click();
      console.log(`Dismissed cookie banner: ${sel}`);
      await page.waitForTimeout(1000);
      break;
    }
  } catch (e) {}
}

await page.waitForTimeout(2000);

// Find and fill search input
const searchSelectors = [
  'input[placeholder*="zip" i]',
  'input[placeholder*="city" i]',
  'input[placeholder*="address" i]',
  'input[placeholder*="location" i]',
  'input[placeholder*="enter" i]',
  'input[placeholder*="search" i]',
  'input[placeholder*="postal" i]',
  'input[name*="zip" i]',
  'input[name*="location" i]',
  'input[name*="search" i]',
  'input[name*="address" i]',
  'input[id*="search" i]',
  'input[id*="dealer" i]',
  'input[id*="location" i]',
  'input[type="search"]',
  'input[type="text"]',
];

let found = false;
for (const sel of searchSelectors) {
  try {
    const inputs = await page.$$(sel);
    for (const input of inputs) {
      if (await input.isVisible()) {
        console.log(`Found input: ${sel}`);
        await input.click();
        await input.fill(zip);
        await page.waitForTimeout(500);
        await input.press("Enter");
        console.log(`Searched for: ${zip}`);
        found = true;
        break;
      }
    }
    if (found) break;
  } catch (e) {}
}

if (!found) {
  console.log("No search input found. Listing visible inputs:");
  const inputs = await page.$$eval("input", (els) =>
    els.filter(e => e.offsetParent !== null).map((e) => ({
      type: e.type, name: e.name, id: e.id, placeholder: e.placeholder
    }))
  );
  console.log(JSON.stringify(inputs, null, 2));
}

// Wait for API responses
await page.waitForTimeout(8000);

// Also try clicking search/find buttons
if (found) {
  for (const sel of ['button:has-text("Search")', 'button:has-text("Find")', 'button:has-text("Go")', 'button[type="submit"]', '.search-btn', '.find-btn']) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click();
        console.log(`Clicked: ${sel}`);
        await page.waitForTimeout(5000);
        break;
      }
    } catch (e) {}
  }
}

await page.waitForTimeout(3000);
console.log("\nDone.");
await browser.close();
