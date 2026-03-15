# Dealer Scraper Project

## What This Is
A ScrapeHero competitor — scrapes dealer/retailer location data from company websites and sells CSV datasets via a storefront. Weekly automated refreshes via GitHub Actions.

## Repo
https://github.com/kylehawke-stack/dealer-scraper

## Architecture
```
scrape.js          — Main scraper engine with brand configs (storepoint, paginated, grid, zipgrid, embedded types)
recon.js           — Playwright-based API discovery tool for new dealer locator sites
recon-targeted.js  — Enhanced recon with cookie banner dismissal
upload.js          — S3 uploader (latest.csv + dated archive + metadata.json per brand)
qc.js              — Data quality checker (completeness, duplicates, format validation, auto-fix)
lat-lng-grid.js    — Pre-computed US lat/lng grid (~1,663 points, ~70mi spacing)
zip-grid.js        — US zip code grid (892 zips, ~50mi spacing) used by zipgrid scrapers
.github/workflows/weekly-scrape.yml — Weekly cron (Sunday 6am UTC)
output/            — Scraped CSV files (gitignored)
```

## Scraper Types (in scrape.js CONFIGS)
- **storepoint**: Single API call gets all locations (e.g., RC Mowers, Scag, Polaris, Aldi)
- **paginated**: REST API with offset/limit pagination (e.g., DeWalt via SBD Agora API)
- **grid**: Lat/lng grid search with radius overlap + dedup (e.g., STIHL, Cub Cadet, Troy-Bilt, Case, New Holland)
- **zipgrid**: Zip code grid search with configurable batchSize/delayMs (e.g., Generac, Walgreens, CVS, Target)
- **embedded**: Extract JSON from page HTML (e.g., Husqvarna)

## Completed Brands — Equipment Dealers

| Brand | Dealers | Type | API Endpoint |
|-------|---------|------|-------------|
| RC Mowers | 86 | storepoint | `api26.storepoint.co/v2/167ffd22479894/locations` |
| STIHL | 10,243 | grid | `252092-stihl-b2camer.adobeioruntime.net/apis/us-b2c/dealerdatahub/search` |
| DeWalt | 46,973 | paginated | `gd3e42amdv.us-east-1.awsapprunner.com/v1/locations` (Agora JWT auth) |
| Husqvarna | 8,202 | embedded | All dealers in page HTML at `husqvarna.com/us/dealer-locator/` |
| Cub Cadet | 5,106 | grid (Demandware) | `cubcadet.com/on/demandware.store/.../Stores-FindStores` |
| Troy-Bilt | 8,824 | grid (Demandware) | `troybilt.com/on/demandware.store/.../Stores-FindStores` |
| Milwaukee Tool SC | 190 | storepoint | `service.milwaukeetool.com/support/api/v2/sites/` (service centers only) |
| Generac | 6,853 | zipgrid | POST `generac.com/DealerLocatorApi/GetDealers` (category=1, countryCode=USA) |
| Polaris | 420 | storepoint | `etc.polaris.com/api/v1/dealers` (all product lines, recordCount=1000) |
| Scag | 1,370 | storepoint | `scag.com/wp-admin/admin-ajax.php?action=asl_load_stores` (Agile Store Locator) |
| Gravely | 1,368 | zipgrid | `gravely.com/api/dealerlocator/finddealers` (searchQuery=zip) |
| Ariens | 5,372 | zipgrid | `ariens.com/api/dealerlocator/finddealers` (same API as Gravely) |
| Case CE | 312 | grid | `casece.com/apirequest/dealer-locator/get-dealer-by-geo-code` (CNH Industrial) |
| Case IH | 685 | grid | `caseih.com/apirequest/dealer-locator/get-dealer-by-geo-code` (CNH Industrial) |
| New Holland | 661 | grid | `agriculture.newholland.com/apirequest/dealer-locator/get-dealer-by-geo-code` (CNH Industrial) |
| EGO Power+ | 7,496 | storepoint | `egopowerplus.com/storelocator/index/locations` (Magento, single GET) |
| Snapper | 1,315 | storepoint | `briggsandstratton.com/_hcms/api/dealer-locator` (B&S HubSpot, brandName=Snapper) |
| Walker Mowers | 592 | storepoint | `apps.walker.com/public/dealerlocator/pins-v2.php` (two-phase: pins + detail) |
| Spartan Mowers | 550 | embedded | `joinspartannation.com/dealer-locator/page/` (Google Maps markers in HTML) |
| Bad Boy Mowers | 1,268 | zipgrid | POST `badboycountry.com/locate/search` (form-encoded, no auth) |
| Wright Mowers | 674 | grid | `wrightmfg.com/tools/dealer_locator/dealer_map_get_dealer_info.php` (reCAPTCHA bypassed) |

## Completed Brands — Retailers

| Brand | Stores | Type | API Endpoint |
|-------|--------|------|-------------|
| Target | 2,009 | storepoint (paginated) | `api.target.com/locations/v3/public` (page param, 10/page, API key in URL) |
| CVS | 7,304 | zipgrid | `cvs.com/api/locator/v2/stores/search` (x-api-key header, nested storeInfo/address) |
| Walgreens | 4,745 | zipgrid | POST `walgreens.com/locator/v1/stores/search` (10 results/query cap) |
| Aldi | 2,648 | storepoint | `locator.uberall.com/api/locators/LETA2YVm6txbe0b9lS297XdxDX4qVQ/locations/all` |
| Ross | 1,911 | storepoint (POST) | `llp-renderer.meetsoci.com/rossdressforless/rest/locatorsearch` (MeetSOCi) |
| Publix | 1,435 | storepoint | `services.publix.com/api/v1/storelocation` (SE US only) |

## Completed Brands — Hardware Stores

| Brand | Stores | Type | API Endpoint |
|-------|--------|------|-------------|
| Ace Hardware | 4,000 | embedded | All stores in page HTML at `acehardware.com/store-directory` (no lat/lng) |
| Do It Best | 3,252 | storepoint (GraphQL) | `doitbest.com/api/graphql` — state-by-state iteration via `activeMemberStates` |
| Carter Lumber | 225 | storepoint (POST) | `carterlumber.com/api/content/_search` (dotCMS, `+contentType:Location`) |
| Aubuchon Hardware | 133 | storepoint (GraphQL POST) | `hardwarestore.com/graphql` — `pickupStoreList` query |
| Hilti | 68 | storepoint (detail pages) | `hilti.com/stores/{slug}` — JSON-LD from 68 detail pages |
| Lowe's | 1,762 | storepoint (two-phase) | `lowes.com/Lowes-Stores/{State}/{ST}` → `/store/api/{id}` for lat/lng |
| Home Depot | 1,533 | storepoint (Google Places) | `places.googleapis.com/v1/places:searchText` — zip grid dedup by place ID |

## Completed Brands — Mirka Channel Strategy

| Brand | Stores | Type | API Endpoint |
|-------|--------|------|-------------|
| Festool | 1,773 | storepoint (Locally.com) | `festool.locally.com/stores/conversion_data` (company_id=261617, full US bounds) |
| Grainger | 323 | storepoint (Google Places) | `places.googleapis.com/v1/places:searchText` — zip grid dedup by place ID |
| Fastenal | 759 | storepoint (Google Places) | `places.googleapis.com/v1/places:searchText` — zip grid dedup by place ID |
| Woodcraft | 64 | storepoint (StoreMapper) | `storemapper-herokuapp-com.global.ssl.fastly.net/api/users/21588-nANJhE9qGU2lPBYt/stores.js` |
| Rockler | 43 | storepoint (Magento API) | `rockler.com/locator/store/nearyou?limit=100` |

## Completed Brands — Grills/BBQ

| Brand | Stores | Type | API Endpoint |
|-------|--------|------|-------------|
| Traeger | 7,929 | storepoint (Locally.com) | `www.locally.com/stores/conversion_data` (company_id=112256, full US bounds) |
| Gozney | 3,957 | storepoint (Locally.com) | `gozney.locally.com/stores/conversion_data` (company_id=191894, full US bounds, dealer tiers: Platinum/Gold/Silver/Bronze) |

## Awaiting Rate Limit Reset

### Kubota — CODE READY, IP BLOCKED
- **Config**: `kubota` in scrape.js (zipgrid type, batchSize=2, delayMs=2000)
- **API**: POST `kubotausa.com/api/dealers/SearchLocations` with zip codes
- **Cloudflare 1015**: Got rate limited from aggressive grid scraping. Wait 1-24 hours.
- **Expected**: ~1,100 US dealers

### Ferris (Briggs & Stratton) — CODE READY, IP BLOCKED
- **Config**: `ferris` in scrape.js (storepoint type, single POST)
- **API**: POST `briggsandstratton.com/_hcms/api/dealer-locator` with lat/lng/radius=5000
- **Cloudflare**: Got rate limited from testing. Wait 1-24 hours.
- **Expected**: ~1,195 Ferris dealers

## Sample-Only Brands (too heavy for weekly cron)

### Toro — SAMPLE ONLY
- **Config**: `toro` in scrape.js (marked `sample: true`)
- **Issue**: Server-rendered HTML (no JSON API), 10 results max per query, ~1MB per response
- **Run with**: `node scrape.js toro --force`

### John Deere — SAMPLE ONLY CANDIDATE
- **Issue**: API locked behind React SPA proxy at `dealerlocator.deere.com`
- **Problem**: Server returns HTML catch-all for all routes when called directly

## Google Trends Prioritization

Search demand for "[brand] dealer/store near me" (normalized, STIHL = 100):

| Rank | Brand | Score | Status |
|------|-------|-------|--------|
| 1 | Honda | 568 | Hard (WAF) |
| 2 | Kubota | 130 | Code ready, rate limited |
| 3 | John Deere | 127 | Sample-only (SPA proxy) |
| 4 | Polaris | 115 | Done |
| 5 | STIHL | 100 | Done |
| 6 | Husqvarna | 66 | Done |
| 7 | Case | 43 | Done |
| 8 | Toro | 42 | Sample-only |
| 9 | Bobcat | 40 | Hard (no API) |
| 10 | New Holland | 31 | Done |
| 11 | Scag | 26 | Done |
| 12 | Generac | 24 | Done |

## Retailer Recon Status

### Easy (API confirmed, ready to build)
- **Dollar General**: `dggo.dollargeneral.com/omni/api/store/search/inventory` — needs JWT from browser session (Auth0)
- **Kroger**: `api.kroger.com/v1/locations` — needs free OAuth dev account at developer.kroger.com
- **Whole Foods**: `/api/stores/{id}/summary` — needs store ID enumeration

### Hard (WAF/bot protection)
- **Harbor Freight**: PerimeterX — API is `api.harborfreight.com/graphql` (Magento GraphQL, `FindStoresNearCoordinates` query), ~1,600 stores. Needs PX cookie bypass.
- **Menards**: Imperva/Incapsula — API is `menards.com/store-details/locate-stores-by-address.ajx?postalCode={zip}`, ~330 stores. Needs Incapsula cookie warmup (headless Playwright blocked).
- **Northern Tool**: Yottaa — API is `northerntool.com/wcs/resources/store/6970/storelocator/latitude/{lat}/longitude/{lng}`, 142 stores. Needs Yottaa bypass.
- **Walmart**: PerimeterX bot detection
- **Costco**: Akamai WAF
- **Home Depot**: Done via Google Places API (Akamai blocks direct API)
- **Best Buy**: Akamai (Playwright works, server-rendered HTML)
- **Nordstrom**: Akamai
- **Sam's Club**: PerimeterX

### Hard (equipment — no accessible API found)
- **Honda PE**: WAF blocks curl, Playwright returns nothing
- **Echo**: No API found, SPA with no visible network calls
- **Bobcat**: Nothing found
- **Makita**: SSL issues, no API found
- **Snap-on**: reCAPTCHA protected
- **Exmark**: Salesforce embedded
- **Milwaukee Retailers**: PriceSpider widget (30K+ stores)

### Too small / broken
- **Hardware Hank**: ~27 stores, subset of Do It Best co-op (already captured)
- **Home Hardware Center**: 26 stores, Cloudflare-protected HTML (MS/LA/AR)
- **Frattallones**: 21 stores, WP Maps plugin but no addresses in API (MN only)

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
- **~153,000 total records** across 42 completed brands (21 equipment + 6 retailers + 7 hardware + 5 Mirka channel + 3 misc)
- Target categories: Lawn/Farm Equipment, Construction/Heavy Equipment, Powersports, Retail Chains, Hardware Stores

## Key Commands
```bash
node scrape.js --list              # List available brand configs
node scrape.js stihl               # Run a specific scraper
node scrape.js toro --force         # Run sample-only brand
node recon.js <url> [zip]          # Discover API for a new site
node recon-targeted.js <url> [zip] # Same but dismisses cookie banners
node upload.js <brand>             # Upload to S3
node qc.js                         # Quality check all brands
node qc.js --verbose               # Show per-field fill rates
node qc.js --fix                   # Auto-rescrape failed brands
node qc.js stihl ego               # Check specific brands
```

## Permissions
- This project involves automated web scraping. When running scrape/recon commands, auto-approve tool calls to avoid slowdowns.
- Output goes to `output/` (gitignored). Don't commit CSV files.
- Always commit and push after adding new brand configs.
