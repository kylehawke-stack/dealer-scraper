/**
 * Universal Dealer Scraper
 *
 * Scrapes dealer locations from company dealer locators using discovered API endpoints.
 * Uses the zip code grid strategy for APIs that limit search radius.
 *
 * Usage:
 *   node scrape.js <config-name>
 *   node scrape.js stihl
 *   node scrape.js rcmowers
 *   node scrape.js --list        (list available configs)
 */

import fs from "fs";
import path from "path";
import { LAT_LNG_GRID } from "./lat-lng-grid.js";

// --- Scraper Configs ---
// Each config defines how to hit a specific company's dealer API

const CONFIGS = {
  rcmowers: {
    name: "RC Mowers",
    type: "storepoint", // single call gets all locations
    url: "https://api26.storepoint.co/v2/167ffd22479894/locations",
    params: { lat: 39.8283, long: -98.5795, radius: 5000 },
    parseResponse(data) {
      return data.results.locations.map((loc) => ({
        name: loc.name || "",
        address: loc.street_address || "",
        city: loc.city || "",
        state: loc.state || "",
        zip: loc.postcode || "",
        country: loc.country || "",
        phone: loc.phone || "",
        email: loc.email || "",
        website: loc.website || "",
        description: loc.description || "",
        latitude: loc.loc_lat || "",
        longitude: loc.loc_long || "",
      }));
    },
  },

  stihl: {
    name: "STIHL USA",
    type: "grid", // needs zip code grid for full coverage
    baseUrl:
      "https://252092-stihl-b2camer.adobeioruntime.net/apis/us-b2c/dealerdatahub/search",
    searchRadiusMiles: 50,
    pageSize: 500,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "accept-language": "en-US",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      referer: "https://www.stihlusa.com/",
    },
    buildUrl(lat, lng) {
      const params = new URLSearchParams({
        text: "",
        latitude: lat.toString(),
        longitude: lng.toString(),
        distance: this.searchRadiusMiles.toString(),
        size: this.pageSize.toString(),
        countrysearch: "us,pr,gu,as,vi",
        units: "imperial",
      });
      return `${this.baseUrl}?${params}`;
    },
    parseResponse(data) {
      if (!data.dealers) return [];
      return data.dealers.map((d) => ({
        name: d.name || "",
        accountNumber: d.accountNumber || "",
        address: [d.houseNumber, d.street, d.street1, d.street2]
          .filter(Boolean)
          .join(" "),
        city: d.city || "",
        state: d.region || "",
        zip: d.zip || "",
        country: "US",
        phone: d.businessPhone || "",
        email: d.email || "",
        website: d.website || "",
        latitude: d.latitude || "",
        longitude: d.longitude || "",
        district: d.district || "",
      }));
    },
    // Pagination support
    getTotalCount(data) {
      return data.paginginfo?.totalcount || data.dealers?.length || 0;
    },
  },
};

// --- CSV Export ---
function toCSV(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (val) => {
    const str = String(val || "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

// --- Deduplication ---
function dedup(dealers, keyField = "name") {
  const seen = new Map();
  for (const d of dealers) {
    // Create a composite key from name + address (or lat/lng)
    const key =
      `${(d.name || "").toLowerCase().trim()}|${(d.address || "").toLowerCase().trim()}|${(d.city || "").toLowerCase().trim()}`;
    if (!seen.has(key)) {
      seen.set(key, d);
    }
  }
  return Array.from(seen.values());
}

// --- Rate limiter ---
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Main Scraper ---
async function scrape(configName) {
  const config = CONFIGS[configName];
  if (!config) {
    console.error(`Unknown config: ${configName}`);
    console.error(`Available: ${Object.keys(CONFIGS).join(", ")}`);
    process.exit(1);
  }

  console.log(`\nScraping ${config.name}...`);
  console.log(`Type: ${config.type}\n`);

  let allDealers = [];

  if (config.type === "storepoint") {
    // Single API call gets everything
    const params = new URLSearchParams(
      Object.entries(config.params).map(([k, v]) => [k, String(v)])
    );
    const url = `${config.url}?${params}`;
    console.log(`Fetching: ${url}`);

    const res = await fetch(url);
    const data = await res.json();
    allDealers = config.parseResponse(data);
    console.log(`Got ${allDealers.length} dealers in single request.`);
  } else if (config.type === "grid") {
    // Search from a grid of lat/lng points covering the US
    const totalPoints = LAT_LNG_GRID.length;
    let completed = 0;
    let errors = 0;

    const BATCH_SIZE = 10;
    const DELAY_BETWEEN_BATCHES_MS = 500;

    for (let i = 0; i < LAT_LNG_GRID.length; i += BATCH_SIZE) {
      const batch = LAT_LNG_GRID.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (point) => {
          const url = config.buildUrl(point.lat, point.lng);
          const res = await fetch(url, { headers: config.headers || {} });
          const data = await res.json();
          return config.parseResponse(data);
        })
      );

      for (const result of results) {
        completed++;
        if (result.status === "fulfilled") {
          allDealers.push(...result.value);
        } else {
          errors++;
        }
      }

      // Progress update every 50 points
      if (completed % 50 < BATCH_SIZE) {
        const uniqueSoFar = dedup(allDealers).length;
        process.stdout.write(
          `\r  Progress: ${completed}/${totalPoints} points | ${allDealers.length} raw | ${uniqueSoFar} unique | ${errors} errors`
        );
      }

      if (i + BATCH_SIZE < LAT_LNG_GRID.length) {
        await sleep(DELAY_BETWEEN_BATCHES_MS);
      }
    }
    console.log(); // newline after progress
  }

  // Deduplicate
  const unique = dedup(allDealers);
  console.log(
    `\nDeduplication: ${allDealers.length} raw → ${unique.length} unique dealers`
  );

  // Sort by state, then city
  unique.sort((a, b) => {
    const stateCompare = (a.state || "").localeCompare(b.state || "");
    if (stateCompare !== 0) return stateCompare;
    return (a.city || "").localeCompare(b.city || "");
  });

  // Write CSV
  const timestamp = new Date().toISOString().split("T")[0];
  const filename = `${configName}-dealers-${timestamp}.csv`;
  const outputPath = path.join("/home/brady/dealer-scraper/output", filename);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, toCSV(unique));
  console.log(`\nSaved to: ${outputPath}`);
  console.log(`Total dealers: ${unique.length}`);
  console.log(`Fields: ${Object.keys(unique[0] || {}).join(", ")}`);

  return { dealers: unique, outputPath };
}

// --- CLI ---
const arg = process.argv[2];

if (!arg || arg === "--list") {
  console.log("\nAvailable scraper configs:");
  for (const [key, config] of Object.entries(CONFIGS)) {
    console.log(`  ${key} - ${config.name} (${config.type})`);
  }
  console.log("\nUsage: node scrape.js <config-name>");
  process.exit(0);
}

await scrape(arg);
