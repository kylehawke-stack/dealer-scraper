/**
 * Kress Product Scraper
 *
 * Scrapes outdoor power equipment from Kress via WordPress REST API.
 * Usage: node scrape-products-kress.js
 */

import fs from "fs";
import { chromium } from "playwright";

const API_BASE = "https://www.kress.com/en-us/wp-json/wp/v2";
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

// Kress US outdoor power categories (from their site navigation)
const CATEGORY_PAGES = [
  { slug: "leaf-blowers", name: "Leaf Blowers" },
  { slug: "chainsaws", name: "Chainsaws" },
  { slug: "grass-trimmers", name: "Grass Trimmers" },
  { slug: "hedge-trimmers", name: "Hedge Trimmers" },
  { slug: "lawn-mowers", name: "Lawn Mowers" },
  { slug: "robotic-lawn-mowers", name: "Robotic Lawn Mowers" },
  { slug: "snow-blowers", name: "Snow Blowers" },
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
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#\d+;/g, "")
    .trim();
}

async function fetchAllProducts() {
  console.log("Fetching all Kress products via WP REST API...");
  const allProducts = [];
  let page = 1;

  while (true) {
    const resp = await fetch(`${API_BASE}/product?per_page=100&page=${page}`, { headers: HEADERS });
    if (!resp.ok) break;

    const totalPages = parseInt(resp.headers.get("x-wp-totalpages") || "1");
    const products = await resp.json();
    if (!products.length) break;

    allProducts.push(...products);
    console.log(`  Page ${page}/${totalPages}: ${products.length} products`);

    if (page >= totalPages) break;
    page++;
  }

  console.log(`  Total: ${allProducts.length} products from API`);
  return allProducts;
}

function categorizeProduct(product) {
  const title = (product.title?.rendered || "").toLowerCase();
  const slug = product.slug || "";
  const content = (product.content?.rendered || "").toLowerCase();

  if (title.includes("blower") || slug.includes("blower")) return "Leaf Blowers";
  if (title.includes("chainsaw") || slug.includes("chainsaw")) return "Chainsaws";
  if (title.includes("trimmer") && (title.includes("grass") || title.includes("string") || slug.includes("trimmer"))) return "Grass Trimmers";
  if (title.includes("hedge") || slug.includes("hedge")) return "Hedge Trimmers";
  if (title.includes("robotic") || title.includes("robot") || slug.includes("robotic")) return "Robotic Lawn Mowers";
  if (title.includes("mower") || title.includes("lawn mower") || slug.includes("mower")) return "Lawn Mowers";
  if (title.includes("snow") || slug.includes("snow")) return "Snow Blowers";
  if (title.includes("battery") || title.includes("charger")) return "Batteries & Chargers";
  return "Other";
}

function parseSpecs(content) {
  const specs = {};
  // Look for common spec patterns in the HTML content
  const specPatterns = [
    /voltage[:\s]*([^<,]+)/i,
    /battery[:\s]*([^<,]+)/i,
    /weight[:\s]*([^<,]+)/i,
    /air\s*(?:volume|speed|velocity)[:\s]*([^<,]+)/i,
    /blowing\s*force[:\s]*([^<,]+)/i,
    /chain\s*speed[:\s]*([^<,]+)/i,
    /bar\s*length[:\s]*([^<,]+)/i,
    /cutting\s*(?:width|capacity|length)[:\s]*([^<,]+)/i,
    /blade\s*length[:\s]*([^<,]+)/i,
    /noise[:\s]*([^<,]+)/i,
    /run\s*time[:\s]*([^<,]+)/i,
  ];

  for (const pattern of specPatterns) {
    const match = content.match(pattern);
    if (match) {
      const key = pattern.source.split("[")[0].replace(/\\s\*/g, " ").replace(/\\/g, "");
      specs[key.trim()] = match[1].trim();
    }
  }

  return specs;
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

    // Price
    const priceEl = document.querySelector(".price-excl, .price, .woocommerce-Price-amount");
    if (priceEl) {
      const match = priceEl.textContent.match(/\$\s*([\d,]+\.?\d*)/);
      if (match) result.price = match[1].replace(/,/g, "");
    }

    // SKU
    const skuEl = document.querySelector(".sku");
    if (skuEl) result.sku = skuEl.textContent.trim();

    // Product image - try multiple selectors
    const imgSelectors = [
      ".woocommerce-product-gallery img",
      ".product-images img",
      ".single-product img[src*='product']",
      ".single-product img[src*='upload']",
      "img.wp-post-image",
      ".product-image img",
    ];
    for (const sel of imgSelectors) {
      const img = document.querySelector(sel);
      if (img && img.src && !img.src.includes("logo") && !img.src.includes("back.png")) {
        result.imageUrl = img.src;
        break;
      }
    }

    // Try og:image meta tag
    if (!result.imageUrl) {
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) result.imageUrl = ogImg.content;
    }

    return result;
  });

  if (data.price) product.price = data.price;
  if (data.sku && !product.sku) product.sku = data.sku;
  if (data.imageUrl) product.imageUrl = data.imageUrl;
}

// --- Main ---
const allWpProducts = await fetchAllProducts();
const date = new Date().toISOString().slice(0, 10);

// Group by category
const byCategory = {};
for (const wp of allWpProducts) {
  const cat = categorizeProduct(wp);
  if (!byCategory[cat]) byCategory[cat] = [];

  const title = stripHtml(wp.title?.rendered || "");
  const description = stripHtml(wp.excerpt?.rendered || wp.content?.rendered || "");
  const content = wp.content?.rendered || "";

  byCategory[cat].push({
    category: cat,
    name: title,
    slug: wp.slug || "",
    description,
    productUrl: wp.link || "",
    ...parseSpecs(content),
  });
}

// Flatten all products for enrichment
const allProducts = Object.values(byCategory).flat();
if (allProducts.length > 0) {
  console.log(`\nEnriching ${allProducts.length} products with page data (price, image)...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  for (let i = 0; i < allProducts.length; i++) {
    const p = allProducts[i];
    process.stdout.write(`  [${i + 1}/${allProducts.length}] ${p.name.slice(0, 50)}...`);
    await enrichFromPage(page, p);
    console.log(` ${p.price ? `$${p.price}` : "no price"}`);
  }

  await browser.close();
}

let totalProducts = 0;
for (const [cat, products] of Object.entries(byCategory).sort()) {
  console.log(`\n${cat}: ${products.length} products`);
  for (const p of products) {
    console.log(`  ${p.name}`);
  }

  const safeCat = cat.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const baseColumns = ["category", "name", "sku", "price", "slug", "description", "imageUrl", "productUrl"];
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
  const filename = `kress-products-${safeCat}-${date}.csv`;
  fs.writeFileSync(`output/${filename}`, "\uFEFF" + csv);
  console.log(`  Wrote to output/${filename}`);
  totalProducts += products.length;
}

console.log(`\nDone! ${totalProducts} total Kress products scraped.`);
