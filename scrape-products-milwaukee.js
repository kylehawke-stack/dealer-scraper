/**
 * Milwaukee Tool Product Scraper — Outdoor Power Equipment
 *
 * Uses Playwright to get a session, then hits the search API.
 * Usage: node scrape-products-milwaukee.js
 */

import fs from "fs";
import { chromium } from "playwright";

const OPE_CATEGORIES = [
  { slug: "blowers", name: "Blowers" },
  { slug: "hedge-trimmers", name: "Hedge Trimmers" },
  { slug: "mowers", name: "Mowers" },
  { slug: "m18-fuel-quik-lok-attachment-system", name: "QUIK-LOK Attachments" },
  { slug: "pruning-shears", name: "Pruning Shears" },
  { slug: "saws", name: "Saws" },
  { slug: "sprayers", name: "Sprayers" },
];

function escapeCsv(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

async function scrapeCategory(page, slug, name) {
  console.log(`\nScraping ${name}...`);
  const url = `https://www.milwaukeetool.com/products/outdoor-power-equipment/${slug}`;

  // Navigate to get the right API call with session cookies
  const products = [];

  const responsePromise = new Promise((resolve) => {
    page.on("response", async (resp) => {
      if (resp.url().includes("/api/search/v3/listings") && resp.status() === 200) {
        try {
          const data = await resp.json();
          resolve(data);
        } catch {
          resolve(null);
        }
      }
    });
  });

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  } catch {
    // networkidle timed out, but API response may still have arrived
    await page.waitForTimeout(3000);
  }
  const data = await Promise.race([responsePromise, new Promise(r => setTimeout(() => r(null), 5000))]);

  if (!data?.listings?.products) {
    console.log("  No products found");
    return [];
  }

  const items = data.listings.products;
  console.log(`  Found ${items.length} products`);

  for (const item of items) {
    const specFields = {};
    for (const prop of item.properties || []) {
      if (prop.displayTitle && prop.displayValue) {
        specFields[prop.displayTitle] = prop.displayValue;
      }
    }

    products.push({
      category: name,
      name: item.title || "",
      sku: item.meta?.sku || item.subtitle || "",
      description: stripHtml(item.description || ""),
      imageUrl: item.image?.url ? `https://www.milwaukeetool.com${item.image.url}` : "",
      productUrl: item.url ? `https://www.milwaukeetool.com${item.url}` : "",
      ...specFields,
    });
    console.log(`  ${item.title} (${item.meta?.sku || ""})`);
  }

  // Remove the response listener to avoid duplicates
  page.removeAllListeners("response");

  return products;
}

function writeCsv(products, filename) {
  const baseColumns = ["category", "name", "sku", "rating", "reviewCount", "description", "imageUrl", "productUrl"];
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
  console.log(`\nWrote ${products.length} products x ${columns.length} columns to output/${filename}`);
}

async function enrichFromPage(page, product) {
  if (!product.productUrl) return;
  try {
    await page.goto(product.productUrl, { waitUntil: "networkidle", timeout: 30000 });
  } catch {
    try {
      await page.goto(product.productUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(3000);
    } catch { return; }
  }

  const data = await page.evaluate(() => {
    const result = {};
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const ld = JSON.parse(script.textContent);
        const items = ld["@graph"] || [ld];
        for (const item of items) {
          if (item.aggregateRating) {
            result.rating = item.aggregateRating.ratingValue;
            result.reviewCount = item.aggregateRating.reviewCount;
          }
        }
      } catch {}
    }
    return result;
  });

  if (data.rating) product.rating = data.rating;
  if (data.reviewCount) product.reviewCount = data.reviewCount;
}

// --- Main ---
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
});
const page = await context.newPage();
const date = new Date().toISOString().slice(0, 10);
let totalProducts = 0;

for (const cat of OPE_CATEGORIES) {
  const products = await scrapeCategory(page, cat.slug, cat.name);
  if (products.length > 0) {
    console.log(`\n  Enriching ${products.length} products with page data...`);
    for (const product of products) {
      process.stdout.write(`    ${product.sku}...`);
      await enrichFromPage(page, product);
      console.log(` ${product.rating ? `★${product.rating} (${product.reviewCount})` : "no rating"}`);
    }
    writeCsv(products, `milwaukee-products-${cat.slug}-${date}.csv`);
    totalProducts += products.length;
  }
}

await browser.close();
console.log(`\nDone! ${totalProducts} total Milwaukee OPE products scraped.`);
