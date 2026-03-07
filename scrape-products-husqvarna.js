/**
 * Husqvarna Product Scraper
 *
 * Crawls product pages and extracts JSON-LD structured data.
 * Usage: node scrape-products-husqvarna.js
 */

import fs from "fs";
import { chromium } from "playwright";

const BASE_URL = "https://www.husqvarna.com";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html",
};

const CATEGORIES = {
  chainsaws: { path: "/us/chainsaws/", name: "Chainsaws" },
  blowers: { path: "/us/leaf-blowers/", name: "Leaf Blowers" },
  trimmers: { path: "/us/brushcutters/", name: "Brushcutters & Trimmers" },
  hedgetrimmers: { path: "/us/hedge-trimmers/", name: "Hedge Trimmers" },
  mowers: { path: "/us/all-lawn-mowers/", name: "Lawn Mowers" },
  zeroturn: { path: "/us/zero-turn-mowers/", name: "Zero Turn Mowers" },
  riders: { path: "/us/riding-lawn-mowers/", name: "Riding Mowers" },
  snowblowers: { path: "/us/snow-blowers/", name: "Snow Blowers" },
  pressurewashers: { path: "/us/pressure-washers/", name: "Pressure Washers" },
  edgers: { path: "/us/edgers/", name: "Edgers" },
};

function escapeCsv(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

async function fetchPage(url) {
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) return null;
  return resp.text();
}

function extractJsonLd(html) {
  const matches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  for (const match of matches) {
    try {
      const data = JSON.parse(match[1]);
      const graph = data["@graph"] || [data];
      for (const item of graph) {
        if (item["@type"] === "ItemPage" && item.mainEntity) {
          return item.mainEntity;
        }
        if (item["@type"] === "Product") {
          return item;
        }
      }
    } catch {}
  }
  return null;
}

async function getProductUrls(categoryPath) {
  const html = await fetchPage(`${BASE_URL}${categoryPath}`);
  if (!html) return [];

  // Find product links (individual product pages, not subcategories)
  const linkPattern = new RegExp(`href="(${categoryPath.replace(/\//g, "\\/")}[a-z0-9-]+\\/)"`, "g");
  const urls = new Set();
  for (const match of html.matchAll(linkPattern)) {
    const path = match[1];
    // Skip subcategory pages (they contain category keywords)
    if (path.includes("about") || path.includes("battery-") || path.includes("gas-") || path.includes("professional-") || path.includes("residential-") || path.includes("top-handle-")) continue;
    urls.add(path);
  }

  // Also check subcategory pages for more products
  const subcatPattern = new RegExp(`href="(${categoryPath.replace(/\//g, "\\/")}(?:battery|gas|professional|residential|robotic|top-handle|electric|cordless|walk-behind|stand-on)[a-z0-9-]*\\/)"`, "g");
  for (const match of html.matchAll(subcatPattern)) {
    const subHtml = await fetchPage(`${BASE_URL}${match[1]}`);
    if (!subHtml) continue;
    for (const subMatch of subHtml.matchAll(linkPattern)) {
      const path = subMatch[1];
      if (!path.includes("about")) urls.add(path);
    }
  }

  return [...urls];
}

async function scrapeCategory(key) {
  const cat = CATEGORIES[key];
  console.log(`\nScraping ${cat.name}...`);

  const productPaths = await getProductUrls(cat.path);
  console.log(`  Found ${productPaths.length} product pages`);

  const products = [];
  for (const path of productPaths) {
    process.stdout.write(`  ${path.split("/").filter(Boolean).pop()}...`);
    const html = await fetchPage(`${BASE_URL}${path}`);
    if (!html) {
      console.log(" SKIP");
      continue;
    }

    const product = extractJsonLd(html);
    if (!product) {
      console.log(" no JSON-LD");
      continue;
    }

    // Extract price from offers
    let price = "";
    let currency = "USD";
    const offers = product.offers;
    if (offers) {
      const offerList = offers.offers || [offers];
      const firstOffer = Array.isArray(offerList) ? offerList[0] : offerList;
      price = firstOffer?.price || "";
      currency = firstOffer?.priceCurrency || "USD";
    }

    // Extract features/specs from additionalProperty
    const specFields = {};
    for (const prop of product.additionalProperty || []) {
      if (prop.name && prop.value) {
        specFields[prop.name] = typeof prop.value === "string" ? stripHtml(prop.value) : String(prop.value);
      }
    }

    const imageUrl = Array.isArray(product.image)
      ? (typeof product.image[0] === "string" ? product.image[0] : product.image[0]?.url?.[0] || "")
      : (product.image?.url?.[0] || product.image || "");

    products.push({
      category: cat.name,
      name: product.name || "",
      sku: product.sku || "",
      brand: product.brand?.name || "Husqvarna",
      price: String(price),
      currency,
      description: stripHtml(product.description || ""),
      imageUrl: Array.isArray(imageUrl) ? imageUrl[0] : imageUrl,
      productUrl: `${BASE_URL}${path}`,
      ...specFields,
    });

    console.log(` OK (${product.name})`);

    // Small delay to be polite
    await new Promise((r) => setTimeout(r, 200));
  }

  return products;
}

async function enrichWithRating(page, product) {
  if (!product.productUrl) return;
  try {
    await page.goto(product.productUrl, { waitUntil: "networkidle", timeout: 30000 });
  } catch {
    try {
      await page.goto(product.productUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(5000);
    } catch { return; }
  }

  // Wait briefly for BazaarVoice to load
  try {
    await page.waitForSelector(".bv_main_rating_button", { timeout: 5000 });
  } catch {}

  const data = await page.evaluate(() => {
    const result = {};
    // BazaarVoice rating
    const ratingEl = document.querySelector(".bv_avgRating_component_container");
    if (ratingEl) {
      const val = parseFloat(ratingEl.textContent.trim());
      if (!isNaN(val)) result.rating = val;
    }
    // Review count from button text: "Read 283 Reviews"
    const btnEl = document.querySelector(".bv_main_rating_button");
    if (btnEl) {
      const match = btnEl.textContent.match(/Read\s+([\d,]+)\s+Review/i);
      if (match) result.reviewCount = parseInt(match[1].replace(/,/g, ""));
    }
    return result;
  });

  if (data.rating) product.rating = data.rating;
  if (data.reviewCount) product.reviewCount = data.reviewCount;
}

function writeCsv(products, filename) {
  const baseColumns = ["category", "name", "sku", "brand", "price", "currency", "rating", "reviewCount", "description", "imageUrl", "productUrl"];
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
  fs.writeFileSync(`output/${filename}`, "\uFEFF" + csv);
  console.log(`  Wrote ${products.length} products x ${columns.length} columns to output/${filename}`);
}

// --- Main ---
const date = new Date().toISOString().slice(0, 10);
const allCategoryProducts = [];

for (const [key, cat] of Object.entries(CATEGORIES)) {
  const products = await scrapeCategory(key);
  if (products.length > 0) {
    allCategoryProducts.push({ key, products });
  }
}

// Enrich all products with ratings via Playwright (BazaarVoice is client-rendered)
const allProducts = allCategoryProducts.flatMap(c => c.products);
if (allProducts.length > 0) {
  console.log(`\nEnriching ${allProducts.length} products with ratings (BazaarVoice)...`);
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
  writeCsv(products, `husqvarna-products-${key}-${date}.csv`);
  totalProducts += products.length;
}

console.log(`\nDone! ${totalProducts} total Husqvarna products scraped.`);
