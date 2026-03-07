/**
 * EGO Product Scraper
 *
 * Scrapes outdoor power equipment from EGO using GraphQL for listing + Playwright for full specs.
 * Usage: node scrape-products-ego.js
 */

import fs from "fs";
import { chromium } from "playwright";

const GRAPHQL_URL = "https://egopowerplus.com/graphql";
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  Store: "default",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

const CATEGORIES = {
  blowers: { id: "15", name: "Blowers" },
  chainsaws: { id: "8", name: "Chain Saws" },
  edgers: { id: "9", name: "Edgers" },
  hedgetrimmers: { id: "10", name: "Hedge Trimmers" },
  mowers: { id: "56", name: "Mowers" },
  ridingmowers: { id: "377", name: "Riding Mowers" },
  multihead: { id: "11", name: "Multi-Head System" },
  polesaw: { id: "483", name: "Pole Saw" },
  snowblowers: { id: "17", name: "Snow Blowers" },
  trimmers: { id: "18", name: "String Trimmers" },
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
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#\d+;/g, "").replace(/\s+/g, " ").trim();
}

async function getProductList(catId) {
  const query = `{
    products(
      filter: { category_id: { eq: "${catId}" } }
      pageSize: 100
    ) {
      total_count
      items {
        name
        sku
        url_key
        short_description { html }
        description { html }
        price_range {
          minimum_price {
            regular_price { value currency }
            final_price { value currency }
          }
        }
        image { url }
      }
    }
  }`;

  const resp = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ query }),
  });
  const data = await resp.json();
  return data?.data?.products?.items || [];
}

async function scrapeProductPage(page, url) {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  } catch {
    // Try with domcontentloaded if networkidle times out
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(3000);
    } catch {
      return {};
    }
  }

  return page.evaluate(() => {
    const result = {};

    // 1. JSON-LD: rating + review count
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const ld = JSON.parse(script.textContent);
        if (ld.aggregateRating) {
          result.rating = ld.aggregateRating.ratingValue;
          result.reviewCount = ld.aggregateRating.reviewCount;
        }
      } catch {}
    }

    // 2. Tech Specs bullet points + Details subtitle
    const detailItems = document.querySelectorAll(".ego-details-item");
    const techSpecBullets = [];
    for (const item of detailItems) {
      const title = item.querySelector(".ego-details-item__title")?.textContent?.trim();
      const listItems = [...item.querySelectorAll("li")].map((li) => li.textContent.trim()).filter(Boolean);
      if (title === "Tech Specs" && listItems.length) {
        techSpecBullets.push(...listItems);
        result.techSpecs = listItems.join("; ");
      }
      if (title === "Details" || title === "DETAILS") {
        const subtitle = item.querySelector(".ego-details-item__subtitle")?.textContent?.trim();
        if (subtitle) result.details = subtitle;
      }
    }

    // 3. Variant configuration table (Type, Battery, Charger)
    const containers = document.querySelectorAll(".ego-configuration-wrapp__attributes-dynamic-container");
    if (containers.length > 0) {
      // Get the first variant (kit version) data
      const first = containers[0];
      const type = first.querySelector("[class*=dynamic-type]")?.textContent?.trim();
      const battery = first.querySelector("[class*=dynamic-battery]")?.textContent?.trim();
      const charger = first.querySelector("[class*=dynamic-charger]")?.textContent?.trim();
      if (type) result.kitType = type;
      if (battery) result.batteryIncluded = battery.replace(/included$/i, "").trim();
      if (charger) result.chargerIncluded = charger.replace(/included$/i, "").trim();
    }

    // 4. Product specs table (if exists — some products have a comparison grid)
    const specRows = document.querySelectorAll(".ego-product-spec tr, .product-attribute-specs-table tr");
    for (const row of specRows) {
      const label = row.querySelector("th, td:first-child")?.textContent?.trim();
      const value = row.querySelector("td:last-child")?.textContent?.trim();
      if (label && value && label !== value) {
        result["spec_" + label] = value;
      }
    }

    // 5. Parse structured specs from tech spec bullets + description + full page text
    // Combine all text sources for regex matching
    const descText = result.details || "";
    const bulletText = techSpecBullets.join(" ");
    const fullText = document.body.innerText;
    const allText = bulletText + " " + descText + " " + fullText;

    const patterns = [
      { key: "CFM", pattern: /(\d[\d,]*)\s*CFM/ },
      { key: "MPH", pattern: /(\d[\d,]*)\s*MPH/ },
      { key: "Voltage", pattern: /(\d+)\s*V(?:olt)?(?:\s|$|,)/  },
      { key: "Run Time", pattern: /(?:up to\s+)?(\d+)\s*min(?:ute)?s?\s*(?:of\s+)?(?:average\s+)?(?:run|runtime)/i },
      { key: "Weight (lbs)", pattern: /(?:weighs?\s*(?:only\s*)?|weight[:\s]+)(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)/i },
      { key: "Cutting Width", pattern: /(\d+)[- ]?(?:inch|in\.?|")\s*(?:cut|deck|swath|mow|blade)/i },
      { key: "Bar Length", pattern: /(\d+)[- ]?(?:inch|in\.?|")\s*(?:bar|chain|guide)/i },
      { key: "Clearing Width", pattern: /(\d+)[- ]?(?:inch|in\.?|")\s*(?:clear|intake|auger)/i },
      { key: "Noise Level", pattern: /(\d+)\s*dB/i },
      { key: "IPX Rating", pattern: /(IPX\d)/i },
      { key: "Newton Force", pattern: /(\d+(?:\.\d+)?)\s*[Nn]ewtons?/ },
      { key: "Motor Power", pattern: /(\d+)\s*W\s*(?:motor|brushless)/i },
      { key: "Chain Speed", pattern: /(\d+(?:\.\d+)?)\s*m\/s/i },
      { key: "RPM", pattern: /([\d,]+)\s*RPM/i },
      { key: "Torque (ft-lbs)", pattern: /([\d.]+)\s*foot[- ]?pounds?\s*(?:of\s+)?torque/i },
      { key: "Throw Distance", pattern: /(\d+)\s*(?:feet|ft\.?)\s*(?:throw|distance)/i },
    ];
    for (const { key, pattern } of patterns) {
      if (!result[key]) {
        const match = allText.match(pattern);
        if (match) result[key] = (match[1] || match[0]).replace(/,/g, "");
      }
    }

    // 6. Warranty from tech specs bullets (only bullets that lead with warranty info)
    for (const bullet of techSpecBullets) {
      if (/^\d+[- ]?year\s+limited/i.test(bullet)) {
        if (!result.warranty) result.warranty = bullet;
      }
    }

    return result;
  });
}

function writeCsv(products, filename) {
  const baseColumns = [
    "category", "name", "sku", "price", "currency",
    "rating", "reviewCount",
    "description", "fullDescription", "techSpecs",
    "kitType", "batteryIncluded", "chargerIncluded",
    "warranty",
    "imageUrl", "productUrl",
  ];
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
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
});
const page = await context.newPage();
const date = new Date().toISOString().slice(0, 10);
let totalProducts = 0;

for (const [key, cat] of Object.entries(CATEGORIES)) {
  console.log(`\nScraping ${cat.name}...`);
  const items = await getProductList(cat.id);
  console.log(`  Found ${items.length} products via GraphQL`);

  const products = [];
  for (const item of items) {
    const url = item.url_key ? `https://egopowerplus.com/${item.url_key}/` : null;
    process.stdout.write(`  ${item.name}...`);

    // Get page-level specs via Playwright
    let pageData = {};
    if (url) {
      pageData = await scrapeProductPage(page, url);
    }

    const price = item.price_range?.minimum_price;
    const priceVal = price?.final_price?.value || price?.regular_price?.value || 0;

    products.push({
      category: cat.name,
      name: item.name,
      sku: item.sku,
      price: priceVal > 0 ? priceVal.toFixed(2) : "",
      currency: "USD",
      description: stripHtml(item.short_description?.html),
      fullDescription: stripHtml(item.description?.html),
      imageUrl: item.image?.url || "",
      productUrl: url || "",
      ...pageData,
    });

    console.log(" OK");
  }

  if (products.length > 0) {
    writeCsv(products, `ego-products-${key}-${date}.csv`);
    totalProducts += products.length;
  }
}

await browser.close();
console.log(`\nDone! ${totalProducts} total EGO products scraped.`);
