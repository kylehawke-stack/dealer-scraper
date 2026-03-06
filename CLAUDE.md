# Dealer Scraper Project

## What This Is
A ScrapeHero competitor — scrapes dealer/retailer location data from company websites and sells CSV datasets via a storefront. Weekly automated refreshes via GitHub Actions.

## Repo
https://github.com/kylehawke-stack/dealer-scraper

## Architecture
```
scrape.js          — Main scraper engine with brand configs (storepoint, paginated, grid types)
recon.js           — Playwright-based API discovery tool for new dealer locator sites
recon-targeted.js  — Enhanced recon with cookie banner dismissal
upload.js          — S3 uploader (latest.csv + dated archive + metadata.json per brand)
lat-lng-grid.js    — Pre-computed US lat/lng grid (~1,663 points, ~70mi spacing)
zip-grid.js        — US zip code grid (legacy, replaced by lat-lng-grid)
.github/workflows/weekly-scrape.yml — Weekly cron (Sunday 6am UTC)
output/            — Scraped CSV files (gitignored)
```

## Scraper Types (in scrape.js CONFIGS)
- **storepoint**: Single API call gets all locations (e.g., RC Mowers via Storepoint.co)
- **paginated**: REST API with offset/limit pagination (e.g., DeWalt via SBD Agora API)
- **grid**: Lat/lng grid search with radius overlap + dedup (e.g., STIHL via Adobe IO)

## Completed Brands

| Brand | Dealers | Type | API Endpoint |
|-------|---------|------|-------------|
| RC Mowers | 26 | storepoint | `api26.storepoint.co/v2/167ffd22479894/locations` |
| STIHL | 10,244 | grid | `252092-stihl-b2camer.adobeioruntime.net/apis/us-b2c/dealerdatahub/search` |
| DeWalt | 46,972 | paginated | `gd3e42amdv.us-east-1.awsapprunner.com/v1/locations` (Agora JWT auth) |

## In-Progress Brands (recon done, configs not yet added to scrape.js)

### Husqvarna — READY TO BUILD
- **Method**: All 8,222 dealers embedded as JSON in page HTML (`/us/dealer-locator/`)
- **Data location**: `initialData.dealers` array in page source
- **Type**: New type needed — "embedded" (curl page, extract JSON, parse)
- **Fields**: id, title, cord (lat/lng), address, phone, email, web, openHours, services

### Kubota — READY TO BUILD
- **Method**: POST to `https://www.kubotausa.com/api/dealers/SearchLocations`
- **Body**: `{"LocationQuery":"30301","Equipment":"","IsRegional":false,"State":"","FilterByOrangeRental":false}`
- **Returns**: All dealers near a location (~825 per search, ~1,100 total US)
- **Type**: Could use grid approach with zip codes, or iterate by state
- **Fields**: DealerNumber, DealerName, Address (Street, City, StateCode, Zip, Lat, Lng), Phone, Fax, DealerEmail, ProductCodes

### John Deere — API FOUND, NEED REQUEST FORMAT
- **API base**: `https://dealerlocatorapi.deere.com/api/gdl-service`
- **Main JS**: `https://dealerlocator.deere.com/gdl/main.js` (contains endpoint patterns)
- **Known endpoints**: `/reverseGeoCode`, `/gdlDynamicForm?locale=`
- **Status**: API accepts requests (returns 500 = wrong format, not 401/403). Need to reverse-engineer the exact POST body from main.js

### Toro — NEEDS MORE RECON
- **Locator URL**: `https://www.toro.com/en/locator`
- **Known JS files**: `cdn2.toro.com/js/locator`, `cdn2.toro.com/js/locatorResults`
- **Status**: Cookie consent blocks interaction in Playwright. Need to download the locator JS files and find the API endpoint

### Cub Cadet — NEEDS MORE RECON
- **Platform**: Salesforce Commerce Cloud (Demandware)
- **URL pattern**: `cubcadet.com/on/demandware.store/Sites-cubcadet-Site/en_US/Stores-Find`
- **Status**: Need to find the Demandware stores API endpoint (usually `/on/demandware.store/.../Stores-FindStores?...`)

## How to Add a New Brand
1. Run `node recon.js <dealer-locator-url>` (or `recon-targeted.js` for sites with cookie banners)
2. Identify the API endpoint from the output (look for "LIKELY DEALER API" markers)
3. Test the API directly with curl to understand params, auth, pagination
4. Add a config to `CONFIGS` in `scrape.js`
5. Run `node scrape.js <brand-name>` to test
6. Add to the matrix in `.github/workflows/weekly-scrape.yml`
7. Commit and push

## Infrastructure Status
- **GitHub Actions cron**: Configured, needs S3 secrets to activate uploads
- **S3 upload script**: Complete (`upload.js`), needs `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`
- **Storefront**: User is designing in v0.app, not yet built
- **Stripe integration**: Not yet built

## Competitive Context
- **ScrapeHero** has 5,125 datasets, 503 dealer-specific, priced $5-$100 per dataset
- Our advantage: fresher data (weekly vs monthly), we already match/exceed their counts
- Target categories: Lawn/Farm Equipment, Construction/Heavy Equipment, Auto Dealers

## Key Commands
```bash
node scrape.js --list              # List available brand configs
node scrape.js stihl               # Run a specific scraper
node recon.js <url> [zip]          # Discover API for a new site
node recon-targeted.js <url> [zip] # Same but dismisses cookie banners
node upload.js <brand>             # Upload to S3 (needs env vars)
```

## Permissions
- This project involves automated web scraping. When running scrape/recon commands, auto-approve tool calls to avoid slowdowns.
- Output goes to `output/` (gitignored). Don't commit CSV files.
- Always commit and push after adding new brand configs.
