/**
 * Upload scraped CSV files to S3 for the storefront to serve.
 *
 * Usage: node upload.js <brand>
 *
 * Env vars:
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   S3_BUCKET (e.g., "dealer-scraper-data")
 *   AWS_REGION (default: us-east-1)
 *
 * Uploads to:
 *   s3://<bucket>/<brand>/latest.csv        (always overwritten)
 *   s3://<bucket>/<brand>/<date>.csv         (archived copy)
 *   s3://<bucket>/<brand>/metadata.json      (row count, date, fields)
 */

import fs from "fs";
import path from "path";
import { createHash, createHmac } from "crypto";

const brand = process.argv[2];
if (!brand) {
  console.error("Usage: node upload.js <brand>");
  process.exit(1);
}

const bucket = process.env.S3_BUCKET;
const region = process.env.AWS_REGION || "us-east-1";
const accessKey = process.env.AWS_ACCESS_KEY_ID;
const secretKey = process.env.AWS_SECRET_ACCESS_KEY;

if (!bucket || !accessKey || !secretKey) {
  console.error("Missing env vars: S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY");
  process.exit(1);
}

// Find the most recent CSV for this brand
const outputDir = path.join(process.cwd(), "output");
const files = fs.readdirSync(outputDir).filter((f) => f.startsWith(`${brand}-dealers-`) && f.endsWith(".csv"));
files.sort().reverse();

if (files.length === 0) {
  console.error(`No CSV files found for brand: ${brand}`);
  process.exit(1);
}

const csvFile = files[0];
const csvPath = path.join(outputDir, csvFile);
const csvContent = fs.readFileSync(csvPath);
const date = csvFile.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || new Date().toISOString().split("T")[0];

// Count rows and extract fields
const lines = csvContent.toString().split("\n").filter((l) => l.trim());
const rowCount = lines.length - 1; // exclude header
const fields = lines[0].split(",");

console.log(`Uploading ${csvFile}: ${rowCount} rows, ${fields.length} fields`);

// --- S3 upload via AWS Signature V4 ---
async function s3Put(key, body, contentType = "text/csv") {
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const shortDate = dateStamp.substring(0, 8);

  const payloadHash = createHash("sha256").update(body).digest("hex");

  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": dateStamp,
    "content-type": contentType,
    "content-length": Buffer.byteLength(body).toString(),
  };

  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join("");

  const canonicalRequest = [
    "PUT",
    `/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${shortDate}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    dateStamp,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const signingKey = [shortDate, region, "s3", "aws4_request"].reduce(
    (key, msg) => createHmac("sha256", key).update(msg).digest(),
    `AWS4${secretKey}`
  );

  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}/${key}`, {
    method: "PUT",
    headers: { ...headers, authorization },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`S3 PUT ${key} failed (${res.status}): ${err}`);
  }

  console.log(`  Uploaded: s3://${bucket}/${key}`);
}

// Upload CSV as latest + dated archive
await s3Put(`${brand}/latest.csv`, csvContent);
await s3Put(`${brand}/${date}.csv`, csvContent);

// Upload metadata
const metadata = {
  brand,
  date,
  rowCount,
  fields,
  fileSize: csvContent.length,
  updatedAt: new Date().toISOString(),
};
await s3Put(`${brand}/metadata.json`, JSON.stringify(metadata, null, 2), "application/json");

console.log(`\nDone! Metadata: ${JSON.stringify(metadata, null, 2)}`);
