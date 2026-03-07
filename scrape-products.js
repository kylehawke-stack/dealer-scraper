/**
 * STIHL Product Scraper - Test
 *
 * Scrapes product catalog data from STIHL USA via their Adobe I/O Runtime API.
 * Usage:
 *   node scrape-products.js                # scrape all categories
 *   node scrape-products.js blowers        # scrape a single category
 *   node scrape-products.js --list         # list available categories
 */

import fs from "fs";
import { chromium } from "playwright";

const API_BASE = "https://252092-stihl-b2camer.adobeioruntime.net/apis/us-b2c";
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  Origin: "https://www.stihlusa.com",
  Referer: "https://www.stihlusa.com/",
};

const CATEGORIES = {
  chainsaws: { id: "1027901", name: "Chainsaws" },
  trimmers: { id: "1027936", name: "Brushcutters & Grass Trimmers" },
  blowers: { id: "1027962", name: "Leaf Blowers & Vacuum Shredders" },
  hedgetrimmers: { id: "1027994", name: "Hedge Trimmers" },
  kombisystem: { id: "1028018", name: "KombiSystem" },
  mowers: { id: "1027889", name: "Lawn Mowers" },
  pressurewashers: { id: "1028077", name: "Pressure Washers" },
  edgers: { id: "1028041", name: "Edgers" },
  polepruners: { id: "1028028", name: "Pole Pruners" },
  earthaugers: { id: "1028051", name: "Earth Augers" },
  cutoffmachines: { id: "1028054", name: "Cut-Off Machines" },
  concretecutters: { id: "1028065", name: "Concrete Cutters" },
  sprayers: { id: "1028067", name: "Mistblowers & Sprayers" },
  vacuums: { id: "1028089", name: "Wet/Dry Vacuum Cleaners" },
  pruners: { id: "1028097", name: "Secateurs, Shears & Pruners" },
  forestrytools: { id: "1028122", name: "Axes, Hatchets & Forestry Tools" },
  sweepers: { id: "1028127", name: "Sweeping Machines" },
  inflators: { id: "1028134", name: "Inflators & Compressors" },
  powersupply: { id: "1028136", name: "Power Supply" },
  bedredefiner: { id: "1028049", name: "Bed Redefiner" },
  zeroturn: { id: "1027877", name: "Zero Turn Mowers" },
};

async function searchProducts(categoryId, limit = 100, offset = 0) {
  const resp = await fetch(`${API_BASE}/products/search`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      sort: null,
      limit,
      offset,
      seoFilter: "",
      searchQueryContext: "MODELS",
      selectedFacets: `allCategories:${categoryId}`,
      isAlgoliaSearchEnabled: true,
      disjunctiveFacets: [],
      dealerBranchCode: "",
    }),
  });
  return resp.json();
}

async function getProductDetail(productId) {
  const resp = await fetch(`${API_BASE}/products/${productId}`, {
    headers: HEADERS,
  });
  return resp.json();
}

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#\d+;/g, "").trim();
}

function formatPrice(cents) {
  if (!cents && cents !== 0) return "";
  return (cents / 100).toFixed(2);
}

function escapeCsv(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function enrichWithRating(page, product) {
  if (!product.productUrl) return;
  try {
    await page.goto(product.productUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2000);
  } catch { return; }

  const data = await page.evaluate(() => {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const ld = JSON.parse(script.textContent);
        const items = ld["@graph"] || [ld];
        for (const item of items) {
          if (item.aggregateRating) {
            return {
              rating: item.aggregateRating.ratingValue,
              reviewCount: item.aggregateRating.reviewCount,
            };
          }
        }
      } catch {}
    }
    return {};
  });

  if (data.rating) product.rating = data.rating;
  if (data.reviewCount) product.reviewCount = data.reviewCount;
}

async function scrapeCategory(key) {
  const cat = CATEGORIES[key];
  if (!cat) {
    console.error(`Unknown category: ${key}`);
    return [];
  }

  console.log(`\nScraping ${cat.name} (${cat.id})...`);

  // Step 1: Get all product IDs from search
  const searchData = await searchProducts(cat.id, 200);
  console.log(`  Found ${searchData.total} products in search`);

  if (!searchData.results?.length) return [];

  // Step 2: Fetch detail for each product
  const products = [];
  for (const item of searchData.results) {
    process.stdout.write(`  Fetching detail: ${item.name}...`);
    try {
      const detail = await getProductDetail(item.id);

      const buyPrice = item.prices?.find((p) => p.type === "BUY");
      const rrpPrice = item.prices?.find((p) => p.type === "RRP");

      const features = (detail.feature || []).map((f) => f.name).join("; ");

      // Parse each spec into its own keyed field
      const specFields = {};
      for (const s of detail.features || []) {
        specFields[s.name] = `${s.value}${s.unit ? " " + s.unit : ""}`;
      }

      products.push({
        category: cat.name,
        name: item.name,
        familyName: item.familyName || "",
        sku: item.sku,
        masterVariantId: item.masterVariantId || "",
        powerType: item.productPower || "",
        buyPrice: formatPrice(buyPrice?.amount),
        rrpPrice: formatPrice(rrpPrice?.amount),
        currency: buyPrice?.currency || "USD",
        highlights: (item.highlights || []).join("; "),
        description: stripHtml(detail.description),
        features,
        imageUrl: item.assets?.[0]?.url || "",
        productUrl: item.url ? `https://www.stihlusa.com${item.url}` : "",
        ...specFields,
      });

      console.log(" OK");
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
    }
  }

  return products;
}

function writeCsv(products, filename) {
  const baseColumns = [
    "category", "name", "familyName", "sku", "masterVariantId",
    "powerType", "buyPrice", "rrpPrice", "currency", "rating", "reviewCount",
    "highlights", "description", "features", "imageUrl", "productUrl",
  ];

  // Collect all unique spec column names across products
  const specNames = new Set();
  for (const p of products) {
    for (const key of Object.keys(p)) {
      if (!baseColumns.includes(key)) specNames.add(key);
    }
  }
  const specColumns = [...specNames].sort();
  const columns = [...baseColumns, ...specColumns];

  const header = columns.join(",");
  const rows = products.map((p) => columns.map((c) => escapeCsv(p[c])).join(","));

  const csv = [header, ...rows].join("\n");
  fs.mkdirSync("output", { recursive: true });
  const filepath = `output/${filename}`;
  fs.writeFileSync(filepath, "\uFEFF" + csv);
  console.log(`\nWrote ${products.length} products x ${columns.length} columns (${specColumns.length} spec columns) to ${filepath}`);
}

// --- Main ---
const arg = process.argv[2];

if (arg === "--list") {
  console.log("Available categories:");
  for (const [key, val] of Object.entries(CATEGORIES)) {
    console.log(`  ${key.padEnd(20)} ${val.name} (${val.id})`);
  }
  process.exit(0);
}

const categoriesToScrape = arg ? [arg] : Object.keys(CATEGORIES);
const date = new Date().toISOString().slice(0, 10);
const allCategoryProducts = [];

for (const key of categoriesToScrape) {
  const products = await scrapeCategory(key);
  if (products.length > 0) {
    allCategoryProducts.push({ key, products });
  }
}

// Enrich all products with ratings via Playwright
const allProducts = allCategoryProducts.flatMap(c => c.products);
if (allProducts.length > 0) {
  console.log(`\nEnriching ${allProducts.length} products with ratings...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  for (let i = 0; i < allProducts.length; i++) {
    const p = allProducts[i];
    process.stdout.write(`  [${i + 1}/${allProducts.length}] ${p.name}...`);
    await enrichWithRating(page, p);
    console.log(` ${p.rating ? `★${p.rating} (${p.reviewCount})` : "no rating"}`);
  }

  await browser.close();
}

let totalProducts = 0;
for (const { key, products } of allCategoryProducts) {
  writeCsv(products, `stihl-products-${key}-${date}.csv`);
  totalProducts += products.length;
}

console.log(`\nDone! ${totalProducts} total products scraped across ${categoriesToScrape.length} categories.`);
