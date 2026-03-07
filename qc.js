/**
 * Dealer Data Quality Check
 *
 * Validates scraped CSV files for completeness, consistency, and common errors.
 * Self-diagnoses issues and optionally re-scrapes brands that fail checks.
 *
 * Usage:
 *   node qc.js                    # check all brands with output CSVs
 *   node qc.js stihl ego          # check specific brands
 *   node qc.js --fix              # re-scrape brands that fail critical checks
 *   node qc.js --verbose          # show per-field stats for every brand
 */

import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";

const OUTPUT_DIR = path.join(process.cwd(), "output");

// --- Expected dealer counts (±20% tolerance) ---
// Based on historical successful scrapes
const EXPECTED_COUNTS = {
  rcmowers: 86,
  stihl: 10200,
  dewalt: 46900,
  husqvarna: 8200,
  cubcadet: 5100,
  troybilt: 8800,
  milwaukee: 190,
  generac: 6800,
  polaris: 420,
  scag: 1370,
  gravely: 1370,
  ariens: 5370,
  casece: 310,
  caseih: 685,
  newholland: 660,
  ferris: 1190,
  target: 2000,
  cvs: 7300,
  walgreens: 4700,
  aldi: 2640,
  ross: 1910,
  publix: 1430,
  acehardware: 4000,
  doitbest: 3250,
  carterlumber: 225,
  aubuchon: 133,
  hilti: 68,
  lowes: 1760,
  homedepot: 1530,
  ego: 7500,
  snapper: 1300,
  walker: 590,
  spartan: 550,
  badboy: 1270,
  wright: 670,
  kubota: 1040,
};

// --- Core fields every dealer CSV should have ---
const REQUIRED_FIELDS = ["name", "address", "city", "state", "zip", "country"];
const IMPORTANT_FIELDS = ["phone", "latitude", "longitude"];

// Brands where certain fields are known to be unavailable from the API
const FIELD_EXCEPTIONS = {
  ferris: ["latitude", "longitude"],    // B&S API doesn't return coordinates
  snapper: ["latitude", "longitude"],   // Same B&S API
  acehardware: ["latitude", "longitude"], // Store directory has no coords
};

// US state abbreviations + full names for validation
const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR","GU","VI","AS",
]);
const US_STATE_NAMES = new Set([
  "alabama","alaska","american samoa","arizona","arkansas","california","colorado",
  "connecticut","delaware","district of columbia","district of colombia","florida",
  "georgia","guam","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky",
  "louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi",
  "missouri","montana","nebraska","nevada","new hampshire","new jersey","new mexico",
  "new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania",
  "puerto rico","rhode island","south carolina","south dakota","tennessee","texas",
  "utah","vermont","virgin islands","virginia","washington","west virginia","wisconsin","wyoming",
]);

function parseCsv(content) {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || "";
    }
    rows.push(row);
  }
  return { headers, rows };
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        values.push(current);
        current = "";
      } else {
        current += c;
      }
    }
  }
  values.push(current);
  return values;
}

// --- Quality Checks ---

function checkFieldCompleteness(rows, headers, brand) {
  const issues = [];
  const stats = {};

  for (const field of headers) {
    const filled = rows.filter((r) => r[field] && r[field].trim()).length;
    const pct = rows.length > 0 ? ((filled / rows.length) * 100).toFixed(1) : 0;
    stats[field] = { filled, total: rows.length, pct: parseFloat(pct) };
  }

  // Critical: required fields should be >90% filled
  for (const field of REQUIRED_FIELDS) {
    if (!headers.includes(field)) {
      issues.push({ severity: "CRITICAL", field, msg: `Missing required column: ${field}` });
    } else if (stats[field].pct < 90) {
      issues.push({
        severity: stats[field].pct < 50 ? "CRITICAL" : "WARNING",
        field,
        msg: `${field} only ${stats[field].pct}% filled (${stats[field].filled}/${stats[field].total})`,
      });
    }
  }

  // Important: phone/lat/lng should be >50% filled (unless excepted)
  const exceptions = FIELD_EXCEPTIONS[brand] || [];
  for (const field of IMPORTANT_FIELDS) {
    if (exceptions.includes(field)) continue;
    if (headers.includes(field) && stats[field].pct < 50) {
      issues.push({
        severity: "WARNING",
        field,
        msg: `${field} only ${stats[field].pct}% filled (${stats[field].filled}/${stats[field].total})`,
      });
    }
  }

  return { issues, stats };
}

function checkDuplicates(rows) {
  const issues = [];
  const seen = new Map();
  let dupes = 0;

  for (const row of rows) {
    const key = `${(row.name || "").toLowerCase().trim()}|${(row.address || "").toLowerCase().trim()}|${(row.city || "").toLowerCase().trim()}`;
    if (seen.has(key)) {
      dupes++;
    } else {
      seen.set(key, true);
    }
  }

  if (dupes > 0) {
    const pct = ((dupes / rows.length) * 100).toFixed(1);
    issues.push({
      severity: pct > 5 ? "WARNING" : "INFO",
      field: "duplicates",
      msg: `${dupes} duplicate rows (${pct}%) by name|address|city`,
    });
  }

  return issues;
}

function checkStateValues(rows) {
  const issues = [];
  if (!rows[0]?.state && rows[0]?.state !== "") return issues;

  const invalidStates = [];
  for (const row of rows) {
    const st = (row.state || "").trim();
    if (st && !US_STATES.has(st.toUpperCase()) && !US_STATE_NAMES.has(st.toLowerCase()) && row.country === "US") {
      invalidStates.push(st);
    }
  }

  if (invalidStates.length > 0) {
    const unique = [...new Set(invalidStates)].slice(0, 10);
    issues.push({
      severity: invalidStates.length > rows.length * 0.05 ? "WARNING" : "INFO",
      field: "state",
      msg: `${invalidStates.length} rows with non-standard state codes: ${unique.join(", ")}`,
    });
  }

  return issues;
}

function checkZipFormat(rows) {
  const issues = [];
  let badZips = 0;

  for (const row of rows) {
    const zip = (row.zip || "").trim();
    if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) {
      badZips++;
    }
  }

  if (badZips > 0) {
    const pct = ((badZips / rows.length) * 100).toFixed(1);
    issues.push({
      severity: badZips > rows.length * 0.1 ? "WARNING" : "INFO",
      field: "zip",
      msg: `${badZips} rows (${pct}%) with non-standard zip format`,
    });
  }

  return issues;
}

function checkCoordinates(rows) {
  const issues = [];
  let outOfBounds = 0;

  for (const row of rows) {
    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    if (isNaN(lat) || isNaN(lng)) continue;

    // Check if roughly within US bounds (including territories)
    const inUS =
      (lat >= 17 && lat <= 72 && lng >= -180 && lng <= -60); // CONUS + AK + HI + territories
    if (!inUS) outOfBounds++;
  }

  if (outOfBounds > 0) {
    issues.push({
      severity: outOfBounds > 5 ? "WARNING" : "INFO",
      field: "coordinates",
      msg: `${outOfBounds} rows with coordinates outside US bounds`,
    });
  }

  return issues;
}

function checkPhoneFormat(rows) {
  const issues = [];
  let badPhones = 0;

  for (const row of rows) {
    const phone = (row.phone || "").trim();
    if (!phone) continue;
    // Strip formatting, check if it has 10+ digits
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) badPhones++;
  }

  if (badPhones > 0) {
    const phoneFilled = rows.filter((r) => r.phone?.trim()).length;
    const pct = ((badPhones / phoneFilled) * 100).toFixed(1);
    issues.push({
      severity: pct > 20 ? "WARNING" : "INFO",
      field: "phone",
      msg: `${badPhones} (${pct}%) phones with <10 digits`,
    });
  }

  return issues;
}

function checkRowCount(brand, actualCount) {
  const issues = [];
  const expected = EXPECTED_COUNTS[brand];
  if (!expected) return issues;

  const deviation = Math.abs(actualCount - expected) / expected;
  if (actualCount === 0) {
    issues.push({ severity: "CRITICAL", field: "count", msg: `0 rows — scrape likely failed completely` });
  } else if (deviation > 0.5) {
    issues.push({
      severity: "CRITICAL",
      field: "count",
      msg: `${actualCount} rows — expected ~${expected} (${(deviation * 100).toFixed(0)}% deviation)`,
    });
  } else if (deviation > 0.2) {
    issues.push({
      severity: "WARNING",
      field: "count",
      msg: `${actualCount} rows — expected ~${expected} (${(deviation * 100).toFixed(0)}% deviation)`,
    });
  }

  return issues;
}

function checkDataStaleness(csvFile) {
  const issues = [];
  const dateMatch = csvFile.match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) return issues;

  const fileDate = new Date(dateMatch[1]);
  const daysSince = Math.floor((Date.now() - fileDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSince > 14) {
    issues.push({
      severity: daysSince > 30 ? "WARNING" : "INFO",
      field: "freshness",
      msg: `Data is ${daysSince} days old (scraped ${dateMatch[1]})`,
    });
  }

  return issues;
}

function checkNameQuality(rows) {
  const issues = [];
  let suspicious = 0;

  for (const row of rows) {
    const name = (row.name || "").trim();
    // Check for placeholder/garbage names
    if (name.length <= 1 || /^test/i.test(name) || /^[0-9]+$/.test(name) || name === "null" || name === "undefined") {
      suspicious++;
    }
  }

  if (suspicious > 0) {
    issues.push({
      severity: suspicious > 10 ? "WARNING" : "INFO",
      field: "name",
      msg: `${suspicious} rows with suspicious/empty dealer names`,
    });
  }

  return issues;
}

// --- Run all checks for a brand ---

function runQC(brand, csvFile, verbose = false) {
  const csvPath = path.join(OUTPUT_DIR, csvFile);
  const content = fs.readFileSync(csvPath, "utf-8").replace(/^\uFEFF/, ""); // strip BOM
  const { headers, rows } = parseCsv(content);

  const allIssues = [];

  // Run all checks
  allIssues.push(...checkRowCount(brand, rows.length));
  allIssues.push(...checkDataStaleness(csvFile));

  const { issues: fieldIssues, stats } = checkFieldCompleteness(rows, headers, brand);
  allIssues.push(...fieldIssues);
  allIssues.push(...checkDuplicates(rows));
  allIssues.push(...checkStateValues(rows));
  allIssues.push(...checkZipFormat(rows));
  allIssues.push(...checkCoordinates(rows));
  allIssues.push(...checkPhoneFormat(rows));
  allIssues.push(...checkNameQuality(rows));

  const criticals = allIssues.filter((i) => i.severity === "CRITICAL");
  const warnings = allIssues.filter((i) => i.severity === "WARNING");
  const infos = allIssues.filter((i) => i.severity === "INFO");

  // Determine overall status
  let status = "PASS";
  if (criticals.length > 0) status = "FAIL";
  else if (warnings.length > 0) status = "WARN";

  return { brand, csvFile, status, rows: rows.length, headers, stats, issues: allIssues, criticals, warnings, infos };
}

// --- Fix: re-scrape a brand ---

async function rescrape(brand) {
  console.log(`    Re-scraping ${brand}...`);
  try {
    const result = execSync(`node scrape.js ${brand}`, {
      cwd: process.cwd(),
      timeout: 600000,
      stdio: "pipe",
    });
    const output = result.toString();
    const countMatch = output.match(/Total dealers:\s*(\d+)/);
    if (countMatch) {
      console.log(`    Re-scraped: ${countMatch[1]} dealers`);
      return true;
    }
    console.log(`    Re-scrape completed (could not parse count)`);
    return true;
  } catch (err) {
    console.log(`    Re-scrape FAILED: ${err.message?.split("\n")[0]}`);
    return false;
  }
}

// --- Main ---

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const fix = args.includes("--fix");
const brands = args.filter((a) => !a.startsWith("--"));

// Find all brand CSVs
const allFiles = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".csv") && f.includes("-dealers-"));

// Group by brand, pick most recent
const brandFiles = {};
for (const f of allFiles) {
  const brand = f.replace(/-dealers-.*/, "");
  if (!brandFiles[brand] || f > brandFiles[brand]) {
    brandFiles[brand] = f;
  }
}

const brandsToCheck = brands.length > 0 ? brands : Object.keys(brandFiles).sort();
const results = [];

console.log(`\n  DEALER DATA QUALITY CHECK`);
console.log(`  ========================\n`);

for (const brand of brandsToCheck) {
  const csvFile = brandFiles[brand];
  if (!csvFile) {
    console.log(`  ${brand.padEnd(16)} -- NO CSV FILE FOUND`);
    continue;
  }

  const result = runQC(brand, csvFile, verbose);
  results.push(result);

  // Status icon
  const icon = result.status === "PASS" ? "OK" : result.status === "WARN" ? "!!" : "XX";
  const countStr = String(result.rows).padStart(6);
  console.log(`  [${icon}] ${brand.padEnd(16)} ${countStr} dealers  ${csvFile}`);

  // Print issues
  for (const issue of result.criticals) {
    console.log(`        CRITICAL: ${issue.msg}`);
  }
  for (const issue of result.warnings) {
    console.log(`        WARNING:  ${issue.msg}`);
  }
  if (verbose) {
    for (const issue of result.infos) {
      console.log(`        info:     ${issue.msg}`);
    }
    // Field fill rates
    console.log(`        Fields:`);
    for (const [field, stat] of Object.entries(result.stats)) {
      const bar = stat.pct >= 95 ? "" : stat.pct >= 70 ? " *" : " **";
      console.log(`          ${field.padEnd(20)} ${String(stat.pct).padStart(5)}% (${stat.filled}/${stat.total})${bar}`);
    }
  }
}

// Summary
const passed = results.filter((r) => r.status === "PASS").length;
const warned = results.filter((r) => r.status === "WARN").length;
const failed = results.filter((r) => r.status === "FAIL").length;
const totalDealers = results.reduce((sum, r) => sum + r.rows, 0);

console.log(`\n  SUMMARY`);
console.log(`  -------`);
console.log(`  Brands checked:  ${results.length}`);
console.log(`  Total dealers:   ${totalDealers.toLocaleString()}`);
console.log(`  Passed:          ${passed}`);
console.log(`  Warnings:        ${warned}`);
console.log(`  Failed:          ${failed}`);

// Auto-fix failed brands
if (fix && failed > 0) {
  console.log(`\n  AUTO-FIX: Re-scraping ${failed} failed brand(s)...\n`);
  for (const result of results.filter((r) => r.status === "FAIL")) {
    const success = await rescrape(result.brand);
    if (success) {
      // Re-check after rescrape
      const newFiles = fs.readdirSync(OUTPUT_DIR).filter((f) => f.startsWith(`${result.brand}-dealers-`) && f.endsWith(".csv"));
      newFiles.sort().reverse();
      if (newFiles[0]) {
        const recheck = runQC(result.brand, newFiles[0]);
        const icon = recheck.status === "PASS" ? "OK" : recheck.status === "WARN" ? "!!" : "XX";
        console.log(`    [${icon}] ${result.brand}: ${recheck.rows} dealers after re-scrape`);
        for (const issue of recheck.criticals) {
          console.log(`        CRITICAL: ${issue.msg}`);
        }
        for (const issue of recheck.warnings) {
          console.log(`        WARNING:  ${issue.msg}`);
        }
      }
    }
  }
}

if (failed > 0 && !fix) {
  console.log(`\n  Tip: Run with --fix to auto-rescrape failed brands`);
}

console.log();
process.exit(failed > 0 ? 1 : 0);
