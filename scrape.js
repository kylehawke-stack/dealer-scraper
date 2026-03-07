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
import dotenv from "dotenv";
import { LAT_LNG_GRID } from "./lat-lng-grid.js";
import { ZIP_GRID } from "./zip-grid.js";

dotenv.config();

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

  dewalt: {
    name: "DeWalt",
    type: "paginated",
    baseUrl: "https://gd3e42amdv.us-east-1.awsapprunner.com/v1/locations",
    pageSize: 1000,
    // Agora JWT from dewalt.com/find-retailer page config
    agoraKey:
      "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjY3ZjU1MWZmOTI3ZGRiZGYyMDExNTVlMyJ9.eyJhdXRoS2V5SWQiOiI2N2Y1NTFmZjkyN2RkYmRmMjAxMTU1ZTMiLCJyb2xlcyI6WyI2NzRkZTIxMzViOWM2ZWQxZGNmZDJjZDAiXSwiaWF0IjoxNzQ0MTMwNTU5LCJpc3MiOiJvbSIsInN1YiI6IjY3MGU3NzAyZWZmZDhmNGNiZjIxYjViYiIsImp0aSI6ImVhNGM3OGYxLWNkNDctNDc5ZS05NmZkLTVkMjcyN2EyYmIzNCJ9.L2NdOYzyYByHFSIdUIWfp0qimCXHPPbrgQFdx1b-aZjRnbvZm2BqKebvwX-upHOvv4OCWYq-dmfzNoGGP4h1XIo_C2z2RdQMfFYqQcExYYWNAI-sNMUOJwfJL2VV2kDckkgm4TcU_MONaH3g8cIuqLN-bBHGGRwWlgp_YHOKs3RXSnQ7t5D6HAYVeNnYsdzKT7pqNMjwMIVbcwZN1pcrFN5yF6gi8pe2OZ7lKQMbnQw4d4d-MPAYfy0Kk0-6VPf5NorL3grUlHj5XUTcffq89QksbOaBFD0HCy6T27RjBfsWkwgI3Yyd2NNmOuB8RT1eASMYRTemE-TkpuTNmXSvFA",
    headers() {
      return {
        accept: "application/json",
        authorization: `Bearer ${this.agoraKey}`,
      };
    },
    filterItem(item) {
      return item.market_or_country === "US";
    },
    parseItem(d) {
      const addr = d.address || {};
      const contact = d.contact || {};
      const coords = addr.coordinates || [];
      return {
        name: d.name || "",
        address: [addr.address1, addr.address2].filter(Boolean).join(" "),
        city: addr.city || "",
        state: addr.state || "",
        zip: addr.postal_code || "",
        country: d.market_or_country || "",
        phone: contact.phone || "",
        email: contact.email || "",
        website: contact.website || "",
        latitude: coords[0] || "",
        longitude: coords[1] || "",
        brands: (d.brands || []).join(", "),
        googleRating: d.google_rating || "",
        googleReviews: d.google_reviews_total || "",
      };
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
  husqvarna: {
    name: "Husqvarna",
    type: "embedded", // all dealers embedded as JSON in page HTML
    url: "https://www.husqvarna.com/us/dealer-locator/",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    extractDealers(html) {
      // Find the initialData dealers array embedded in the page
      const marker = '"initialData":{"dealers":[';
      const start = html.indexOf(marker);
      if (start === -1) throw new Error("Could not find dealer data in page");
      const arrStart = html.indexOf("[", start);
      let depth = 0;
      let inStr = false;
      let escape = false;
      for (let i = arrStart; i < html.length; i++) {
        const c = html[i];
        if (escape) { escape = false; continue; }
        if (c === "\\") { escape = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "[") depth++;
        else if (c === "]") {
          depth--;
          if (depth === 0) {
            // Unescape HTML entities
            let arrText = html.slice(arrStart, i + 1)
              .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">").replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'").replace(/&rsquo;/g, "'");
            return JSON.parse(arrText);
          }
        }
      }
      throw new Error("Could not parse dealer array");
    },
    parseResponse(dealers) {
      return dealers.map((d) => {
        // Address format: "street, \r\n\r\ncity, \r\nstate, \r\nzip \r\ncountry"
        const parts = (d.address || "")
          .split(/\r?\n/)
          .map((s) => s.replace(/,\s*$/, "").trim())
          .filter(Boolean);
        return {
          name: d.title || "",
          address: parts[0] || "",
          city: parts[1] || "",
          state: parts[2] || "",
          zip: (parts[3] || "").replace(/\s*USA\s*/, "").trim(),
          country: "US",
          phone: d.phone || "",
          email: d.email || "",
          website: d.web || "",
          latitude: d.cord?.latitude || "",
          longitude: d.cord?.longitude || "",
          services: (d.services || []).join(", "),
        };
      });
    },
  },

  kubota: {
    name: "Kubota",
    type: "zipgrid", // iterate through zip codes
    batchSize: 2, // Cloudflare-protected — go slow
    delayMs: 2000,
    baseUrl: "https://www.kubotausa.com/api/dealers/SearchLocations",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    buildRequest(zip) {
      return {
        url: this.baseUrl,
        options: {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({
            LocationQuery: zip,
            Equipment: "",
            IsRegional: false,
            State: "",
            FilterByOrangeRental: false,
          }),
        },
      };
    },
    parseResponse(data) {
      return (data.results || []).map((d) => {
        const addr = d.Address || {};
        return {
          name: d.DealerName || "",
          dealerNumber: d.DealerNumber || "",
          address: addr.Street || "",
          city: addr.City || "",
          state: addr.StateCode || "",
          zip: addr.Zip || "",
          country: addr.CountryCode || "US",
          phone: d.Phone || "",
          fax: d.Fax || "",
          email: d.DealerEmail || "",
          website: d.DealerWebUrl || "",
          latitude: addr.Latitude || "",
          longitude: addr.Longitude || "",
          productCodes: d.ProductCodes || "",
        };
      });
    },
  },

  cubcadet: {
    name: "Cub Cadet",
    type: "grid",
    baseUrl:
      "https://www.cubcadet.com/on/demandware.store/Sites-cubcadet-Site/en_US/Stores-FindStores",
    searchRadiusMiles: 100,
    headers: {
      accept: "application/json",
      "x-requested-with": "XMLHttpRequest",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    buildUrl(lat, lng) {
      const params = new URLSearchParams({
        showMap: "true",
        radius: this.searchRadiusMiles.toString(),
        lat: lat.toString(),
        long: lng.toString(),
      });
      return `${this.baseUrl}?${params}`;
    },
    parseResponse(data) {
      return (data.stores || []).map((d) => ({
        name: d.name || "",
        dealerId: d.custom?.dealer_id || d.ID || "",
        address: [d.address1, d.address2].filter(Boolean).join(" "),
        city: d.city || "",
        state: d.stateCode || "",
        zip: d.postalCode || "",
        country: d.countryCode || "US",
        phone: d.phone || "",
        website: d.custom?.dealerWebsiteUrl || "",
        latitude: d.latitude || "",
        longitude: d.longitude || "",
        dealerType: d.custom?.DealerType || "",
        isElite: d.custom?.isEliteDealer || false,
        googleRating: d.custom?.googleReviewsAve || "",
        googleReviews: d.custom?.googleReviewsTotal || "",
        categories: (d.custom?.productCategories || []).join(", "),
      }));
    },
  },

  toro: {
    name: "Toro",
    type: "zipgrid", // server-rendered HTML, needs zip code queries
    sample: true, // too heavy for weekly cron — scrape on-demand after purchase
    searchUrl: "https://www.toro.com/en/locator",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    buildRequest(zip) {
      const params = new URLSearchParams({
        countryCode: "US",
        serviceType: "Buy",
        postalCode: zip,
        resultType: "Dealer",
        productType: "267",
        categoryName: "Contractor",
        productTypeName: "Mowers",
        searchRadius: "100",
      });
      return {
        url: `${this.searchUrl}?${params}`,
        options: { headers: this.headers },
      };
    },
    // Override: parse HTML response instead of JSON
    parseHtml: true,
    extractFromHtml(html) {
      const marker = "locations: [";
      const start = html.indexOf(marker);
      if (start === -1) return [];
      const arrStart = html.indexOf("[", start);
      let depth = 0;
      let inStr = false;
      let escape = false;
      for (let i = arrStart; i < html.length; i++) {
        const c = html[i];
        if (escape) { escape = false; continue; }
        if (c === "\\") { escape = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "[") depth++;
        else if (c === "]") {
          depth--;
          if (depth === 0) {
            return JSON.parse(html.slice(arrStart, i + 1));
          }
        }
      }
      return [];
    },
    parseResponse(rawDealers) {
      return rawDealers.map((d) => {
        const addr = d.Address || {};
        return {
          name: d.Name || "",
          dealerId: d.DealerId || "",
          address: [addr.AddressLine1, addr.AddressLine2, addr.AddressLine3]
            .filter(Boolean)
            .join(" "),
          city: addr.City || "",
          state: addr.Region || "",
          zip: addr.PostalCode || "",
          country: addr.Country || "US",
          phone: d.Phone || "",
          email: d.Email || "",
          fax: d.Fax || "",
          website: d.WebSite || "",
          latitude: d.Latitude || "",
          longitude: d.Longitude || "",
          dealerType: d.DealerType || "",
        };
      });
    },
  },
  milwaukee: {
    name: "Milwaukee Tool Service Centers",
    type: "storepoint", // single GET returns all sites
    url: "https://service.milwaukeetool.com/support/api/v2/sites/",
    params: {},
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    parseResponse(data) {
      return (data.sites || [])
        .filter((d) => d.country === "United States")
        .map((d) => ({
          name: d.name || "",
          address: [d.addressLine1, d.addressLine2].filter(Boolean).join(" "),
          city: d.city || "",
          state: d.state || "",
          zip: d.postalCode || "",
          country: "US",
          phone: d.phoneNumber || "",
          latitude: d.latitude || "",
          longitude: d.longitude || "",
          productLines: (d.siteProductLines || [])
            .map((p) => p.description)
            .join(", "),
        }));
    },
  },

  troybilt: {
    name: "Troy-Bilt",
    type: "grid", // Demandware API, same pattern as Cub Cadet
    baseUrl:
      "https://www.troybilt.com/on/demandware.store/Sites-troybilt-Site/en_US/Stores-FindStores",
    searchRadiusMiles: 100,
    headers: {
      accept: "application/json",
      "x-requested-with": "XMLHttpRequest",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    buildUrl(lat, lng) {
      const params = new URLSearchParams({
        showMap: "true",
        radius: this.searchRadiusMiles.toString(),
        lat: lat.toString(),
        long: lng.toString(),
      });
      return `${this.baseUrl}?${params}`;
    },
    parseResponse(data) {
      return (data.stores || []).map((d) => ({
        name: d.name || "",
        dealerId: d.custom?.dealer_id || d.ID || "",
        address: [d.address1, d.address2].filter(Boolean).join(" "),
        city: d.city || "",
        state: d.stateCode || "",
        zip: d.postalCode || "",
        country: d.countryCode || "US",
        phone: d.phone || "",
        website: d.custom?.dealerWebsiteUrl || "",
        latitude: d.latitude || "",
        longitude: d.longitude || "",
        dealerType: d.custom?.DealerType || "",
        googleRating: d.custom?.googleReviewsAve || "",
        googleReviews: d.custom?.googleReviewsTotal || "",
        categories: (d.custom?.productCategories || []).join(", "),
      }));
    },
  },

  generac: {
    name: "Generac",
    type: "zipgrid",
    batchSize: 3,
    delayMs: 1500,
    baseUrl: "https://www.generac.com/DealerLocatorApi/GetDealers",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    buildRequest(zip) {
      return {
        url: this.baseUrl,
        options: {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({
            category: "1",
            city: "",
            countryCode: "USA",
            postalCode: zip,
            radius: 100,
            siteID: 1,
            stateProvince: "",
          }),
        },
      };
    },
    parseResponse(data) {
      return (data.dealers || []).map((d) => ({
        name: d.dealerName || "",
        dealerId: d.id || "",
        address: [d.address1, d.address2].filter(Boolean).join(" ").trim(),
        city: d.city || "",
        state: (d.stateProvince || "").trim(),
        zip: d.postal || "",
        country: d.countryCode || "USA",
        phone: d.phone ? String(d.phone) : "",
        email: d.email || "",
        website: d.webSite || "",
        latitude: d.latitude || "",
        longitude: d.longitude || "",
        dealerStatus: d.dealerStatus || "",
        dealerClass: d.dealerClass || "",
        services: (d.dealerServiceDetailsList || [])
          .map((s) => s.dealerServiceName)
          .join(", "),
      }));
    },
  },

  casece: {
    name: "Case Construction",
    type: "grid",
    baseUrl:
      "https://www.casece.com/apirequest/dealer-locator/get-dealer-by-geo-code",
    searchRadiusMiles: 100,
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    buildUrl(lat, lng) {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lng.toString(),
        pageId: "{362EF176-7313-467C-B2D1-20D7FB62ECFB}",
        language: "en-US",
        country: "US",
      });
      return `${this.baseUrl}?${params}`;
    },
    parseResponse(data) {
      return (data.dealershipResults || []).map((r) => {
        const d = r.dealership || {};
        const attrs = d.dealershipAttributes || {};
        const equipment = (attrs.contractDetails || [])
          .map((c) => c.longDescription)
          .join(", ");
        return {
          name: d.dealerName || "",
          dealerNumber: d.dealerNumber || "",
          address: [d.shippingAddress1, d.shippingAddress2]
            .filter(Boolean)
            .join(" "),
          city: d.shippingCity || "",
          state: d.shippingStateProv || "",
          zip: d.shippingZip || "",
          country: d.countryCode || "US",
          phone: d.shippingPhone || "",
          fax: d.shippingFax || "",
          email: d.dealerEmail || "",
          website: d.dealerWebsite || attrs.website || "",
          latitude: d.latitude || "",
          longitude: d.longitude || "",
          equipment,
        };
      });
    },
  },

  caseih: {
    name: "Case IH",
    type: "grid",
    baseUrl:
      "https://www.caseih.com/apirequest/dealer-locator/get-dealer-by-geo-code",
    searchRadiusMiles: 100,
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    buildUrl(lat, lng) {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lng.toString(),
        pageId: "{12BABBA7-79F2-49A8-B495-DAC335AC856A}",
        language: "en-US",
        country: "US",
      });
      return `${this.baseUrl}?${params}`;
    },
    parseResponse(data) {
      return (data.dealershipResults || []).map((r) => {
        const d = r.dealership || {};
        const attrs = d.dealershipAttributes || {};
        const equipment = (attrs.contractDetails || [])
          .map((c) => c.longDescription)
          .join(", ");
        return {
          name: d.dealerName || "",
          dealerNumber: d.dealerNumber || "",
          address: [d.shippingAddress1, d.shippingAddress2]
            .filter(Boolean)
            .join(" "),
          city: d.shippingCity || "",
          state: d.shippingStateProv || "",
          zip: d.shippingZip || "",
          country: d.countryCode || "US",
          phone: d.shippingPhone || "",
          fax: d.shippingFax || "",
          email: d.dealerEmail || "",
          website: d.dealerWebsite || attrs.website || "",
          latitude: d.latitude || "",
          longitude: d.longitude || "",
          equipment,
        };
      });
    },
  },

  newholland: {
    name: "New Holland Agriculture",
    type: "grid",
    baseUrl:
      "https://agriculture.newholland.com/apirequest/dealer-locator/get-dealer-by-geo-code",
    searchRadiusMiles: 100,
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    buildUrl(lat, lng) {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lng.toString(),
        pageId: "{7465DECF-7E95-4B5E-8271-505BBBB37843}",
        language: "en-US",
        country: "US",
      });
      return `${this.baseUrl}?${params}`;
    },
    parseResponse(data) {
      return (data.dealershipResults || []).map((r) => {
        const d = r.dealership || {};
        const attrs = d.dealershipAttributes || {};
        const equipment = (attrs.contractDetails || [])
          .map((c) => c.longDescription)
          .join(", ");
        return {
          name: d.dealerName || "",
          dealerNumber: d.dealerNumber || "",
          address: [d.shippingAddress1, d.shippingAddress2]
            .filter(Boolean)
            .join(" "),
          city: d.shippingCity || "",
          state: d.shippingStateProv || "",
          zip: d.shippingZip || "",
          country: d.countryCode || "US",
          phone: d.shippingPhone || "",
          fax: d.shippingFax || "",
          email: d.dealerEmail || "",
          website: d.dealerWebsite || attrs.website || "",
          latitude: d.latitude || "",
          longitude: d.longitude || "",
          equipment,
        };
      });
    },
  },

  polaris: {
    name: "Polaris",
    type: "storepoint", // single call gets all ~540 US dealers
    url: "https://etc.polaris.com/api/v1/dealers",
    params: {
      lat: 39.8283,
      lon: -98.5795,
      recordCount: 1000,
      plc: "rgr,rzr,grl,ace,atv,xxp,sno,tsl,cmv,slg,ind,bru,rrs",
      distanceType: "mi",
      distanceToLook: 20000,
      doesSales: true,
    },
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    parseResponse(data) {
      return (Array.isArray(data) ? data : [])
        .filter((d) => d.country === "US")
        .map((d) => {
          const productLines = [
            ...new Set(
              (d.dealerGroupings || []).map((g) => g.productLineCode)
            ),
          ];
          return {
            name: d.businessName || "",
            dealerId: d.dealerId || "",
            address: [d.address1, d.address2].filter(Boolean).join(" "),
            city: d.city || "",
            state: d.region || "",
            zip: d.postalCode || "",
            country: "US",
            phone: d.phone || "",
            email: d.email || "",
            website: d.webSite || d.dealerWebSite || "",
            latitude: d.latitude || "",
            longitude: d.longitude || "",
            doesSales: d.dealerSales || false,
            doesService: d.dealerService || false,
            productLines: productLines.join(", "),
          };
        });
    },
  },

  scag: {
    name: "Scag Power Equipment",
    type: "storepoint", // single AJAX call returns all 1500+ dealers
    url: "https://www.scag.com/wp-admin/admin-ajax.php",
    params: { action: "asl_load_stores", load_all: 1, layout: 1 },
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    parseResponse(data) {
      return (Array.isArray(data) ? data : [])
        .filter((d) => d.country === "United States")
        .map((d) => ({
          name: d.title || "",
          address: d.street || "",
          city: d.city || "",
          state: d.state || "",
          zip: d.postal_code || "",
          country: "US",
          phone: d.phone || "",
          fax: d.fax || "",
          email: d.email || "",
          website: d.website || "",
          latitude: d.lat || "",
          longitude: d.lng || "",
          dealerNetwork: d.dealer_network || "",
        }));
    },
  },

  gravely: {
    name: "Gravely",
    type: "zipgrid",
    batchSize: 5,
    delayMs: 500,
    baseUrl: "https://www.gravely.com/api/dealerlocator/finddealers",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    buildRequest(zip) {
      const params = new URLSearchParams({
        searchQuery: zip,
        type: "",
        isEcommerceFirst: "false",
        isEcommerceOnly: "false",
      });
      return {
        url: `${this.baseUrl}?${params}`,
        options: { headers: this.headers },
      };
    },
    parseResponse(data) {
      return (Array.isArray(data) ? data : [])
        .filter((d) => d.brand === "Gravely")
        .map((d) => ({
          name: d.name || "",
          dealerId: d.id || "",
          address: [d.address1, d.address2].filter(Boolean).join(" "),
          city: d.locality || "",
          state: d.administrativeAreaLevel1 || "",
          zip: d.postalCode || "",
          country: d.country || "US",
          phone: d.phone1 || "",
          website: d.website || "",
          latitude: d.latitude || "",
          longitude: d.longitude || "",
          productTypes: (d.productTypes || []).join(", "),
          dealerClass: d.dealerClass || "",
          lawnLevel: d.lawnLevel || "",
          serviceLevel: d.serviceLevel || "",
        }));
    },
  },

  ariens: {
    name: "Ariens",
    type: "zipgrid",
    batchSize: 5,
    delayMs: 500,
    baseUrl: "https://www.ariens.com/api/dealerlocator/finddealers",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    buildRequest(zip) {
      const params = new URLSearchParams({
        searchQuery: zip,
        type: "",
        isEcommerceFirst: "false",
        isEcommerceOnly: "false",
      });
      return {
        url: `${this.baseUrl}?${params}`,
        options: { headers: this.headers },
      };
    },
    parseResponse(data) {
      return (Array.isArray(data) ? data : [])
        .filter((d) => d.brand === "Ariens")
        .map((d) => ({
          name: d.name || "",
          dealerId: d.id || "",
          address: [d.address1, d.address2].filter(Boolean).join(" "),
          city: d.locality || "",
          state: d.administrativeAreaLevel1 || "",
          zip: d.postalCode || "",
          country: d.country || "US",
          phone: d.phone1 || "",
          website: d.website || "",
          latitude: d.latitude || "",
          longitude: d.longitude || "",
          productTypes: (d.productTypes || []).join(", "),
          dealerClass: d.dealerClass || "",
          snowLevel: d.snowLevel || "",
          lawnLevel: d.lawnLevel || "",
          serviceLevel: d.serviceLevel || "",
        }));
    },
  },

  ferris: {
    name: "Ferris (Briggs & Stratton)",
    type: "storepoint", // single POST with large radius gets all dealers
    url: "https://www.briggsandstratton.com/_hcms/api/dealer-locator",
    params: {},
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    // Override: use POST instead of GET
    fetchOverride: true,
    async fetchData() {
      const res = await fetch(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          latitude: 39.8283,
          longitude: -98.5795,
          radius: 5000,
        }),
      });
      return res.json();
    },
    parseResponse(data) {
      return (Array.isArray(data) ? data : []).map((d) => ({
        name: d.dealerName || "",
        dealerId: d.dealerId || "",
        address: [d.address1, d.address2, d.address3]
          .filter(Boolean)
          .join(" "),
        city: d.city || "",
        state: d.state || "",
        zip: d.zip || "",
        country: d.country || "US",
        phone: d.phone || "",
        email: d.email || "",
        website: d.website || "",
        dealerPageUrl: d.dealerPageURL || "",
        latitude: "",
        longitude: "",
        productLines: (d.productLines || [])
          .map((p) => `${p.productLine} (${p.productSegement})`)
          .join(", "),
      }));
    },
  },
  // ==========================================
  // RETAILERS
  // ==========================================

  target: {
    name: "Target",
    type: "storepoint",
    url: "https://api.target.com/locations/v3/public",
    params: {},
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    fetchOverride: true,
    async fetchData() {
      const allStores = [];
      let page = 1;
      while (true) {
        const url = `${this.url}?limit=10&page=${page}&key=8df66ea1e1fc070a6ea99e942431c9cd67a80f02`;
        const res = await fetch(url, { headers: this.headers });
        const data = await res.json();
        const stores = Array.isArray(data) ? data : [];
        if (stores.length === 0) break;
        allStores.push(...stores);
        process.stdout.write(`\r  Fetched ${allStores.length} stores (page ${page})`);
        page++;
        await new Promise((r) => setTimeout(r, 300));
      }
      console.log();
      return allStores;
    },
    parseResponse(data) {
      const retailTypes = new Set(["General Merch", "Small Format", "SuperTarget"]);
      return (Array.isArray(data) ? data : [])
        .filter((s) => retailTypes.has(s.sub_type_code))
        .map((s) => {
          const addr = (s.address || [])[0] || {};
          const geo = s.geographic_specifications || {};
          const phone = (s.contact_information || []).find(
            (c) => c.building_area === "MAIN" && c.telephone_type === "VOICE"
          );
          const name =
            (s.location_names || []).find((n) => n.name_type === "Proj Name")
              ?.name || "";
          return {
            name: name,
            storeId: String(s.location_id || ""),
            address: addr.address_line1 || "",
            city: addr.city || "",
            state: addr.state || "",
            zip: addr.postal_code || "",
            country: "US",
            phone: phone?.telephone_number || "",
            latitude: geo.latitude || "",
            longitude: geo.longitude || "",
            storeType: s.sub_type_code || "",
          };
        });
    },
  },

  cvs: {
    name: "CVS Pharmacy",
    type: "zipgrid",
    batchSize: 3,
    delayMs: 1000,
    baseUrl: "https://www.cvs.com/api/locator/v2/stores/search",
    headers: {
      "x-api-key": "k6DnPo1puMOQmAhSCiRGYvzMYOSFu903",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    buildRequest(zip) {
      const params = new URLSearchParams({
        searchBy: "ZIPCODE",
        searchText: zip,
        resultsPerPage: "50",
        pageNum: "1",
      });
      return {
        url: `${this.baseUrl}?${params}`,
        options: { headers: this.headers },
      };
    },
    parseResponse(data) {
      return (data.storeList || []).map((d) => {
        const addr = d.address || {};
        const info = d.storeInfo || {};
        const phones = info.phoneNumbers?.[0] || {};
        return {
          name: `CVS #${info.storeId || ""}`,
          storeId: info.storeId || "",
          address: addr.street || "",
          city: addr.city || "",
          state: addr.state || "",
          zip: addr.zip || "",
          country: "US",
          phone: phones.retail || phones.pharmacy || "",
          latitude: info.latitude || "",
          longitude: info.longitude || "",
          storeType: info.storeType || "",
          services: (info.identifier || []).join(", "),
        };
      });
    },
  },

  aldi: {
    name: "Aldi",
    type: "storepoint", // single call gets all ~2,650 stores
    url: "https://locator.uberall.com/api/locators/LETA2YVm6txbe0b9lS297XdxDX4qVQ/locations/all",
    params: {},
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    // Override URL construction since params need repeated fieldMask keys
    fetchOverride: true,
    async fetchData() {
      const fields = ["id", "identifier", "lat", "lng", "name", "country", "city", "province", "streetAndNumber", "zip", "phone"];
      const fieldParams = fields.map((f) => `fieldMask=${f}`).join("&");
      const url = `${this.url}?v=20230110&language=en&${fieldParams}`;
      const res = await fetch(url, { headers: this.headers });
      return res.json();
    },
    parseResponse(data) {
      return (data.response?.locations || [])
        .filter((d) => d.country === "US")
        .map((d) => ({
          name: d.name || "",
          storeId: d.identifier || "",
          address: d.streetAndNumber || "",
          city: d.city || "",
          state: d.province || "",
          zip: d.zip || "",
          country: "US",
          phone: d.phone || "",
          latitude: d.lat || "",
          longitude: d.lng || "",
        }));
    },
  },

  ross: {
    name: "Ross Dress for Less",
    type: "storepoint", // single POST gets all ~1,914 stores
    url: "https://llp-renderer.meetsoci.com/rossdressforless/rest/locatorsearch",
    params: {},
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    fetchOverride: true,
    async fetchData() {
      const res = await fetch(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          request: {
            appkey: "097D3C64-7006-11E8-9405-6974C403F339",
            formdata: {
              dataview: "store_default",
              limit: 5000,
              geolocs: {
                geoloc: [
                  {
                    addressline: "66952",
                    country: "US",
                    latitude: "",
                    longitude: "",
                  },
                ],
              },
              searchradius: "5000",
              where: { and: { "Hide on Locator": { ne: "Yes" } } },
            },
          },
        }),
      });
      return res.json();
    },
    parseResponse(data) {
      return (data.response?.collection || [])
        .filter((d) => d.country === "US")
        .map((d) => ({
          name: d.name || "",
          storeId: d.clientkey || "",
          address: [d.address1, d.address2].filter(Boolean).join(" "),
          city: d.city || "",
          state: d.state || "",
          zip: d.postalcode || "",
          country: "US",
          phone: d.phone || "",
          latitude: d.latitude || "",
          longitude: d.longitude || "",
          mondayHours: `${d.monday_open || ""}-${d.monday_close || ""}`,
          saturdayHours: `${d.saturday_open || ""}-${d.saturday_close || ""}`,
          sundayHours: `${d.sunday_open || ""}-${d.sunday_close || ""}`,
        }));
    },
  },

  walgreens: {
    name: "Walgreens",
    type: "zipgrid",
    batchSize: 5,
    delayMs: 500,
    baseUrl:
      "https://www.walgreens.com/locator/v1/stores/search?requestor=search",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    buildRequest(zip) {
      // Use lat/lng from zip grid would be better, but we need to get coords for zip
      // The API actually accepts zip via a geocoding step, but the direct API needs lat/lng
      // We'll use the zip grid's corresponding lat/lng by looking it up
      return {
        url: this.baseUrl,
        options: {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({
            r: "75",
            lat: "",
            lng: "",
            p: 1,
            s: 10,
            zip: zip,
          }),
        },
      };
    },
    parseResponse(data) {
      return (data.results || []).map((r) => {
        const store = r.store || {};
        const addr = store.address || {};
        const phone = store.phone || {};
        return {
          name: store.name || "",
          storeNumber: store.storeNumber || "",
          brand: store.storeBrand || store.brand || "Walgreens",
          address: addr.street || "",
          city: addr.city || "",
          state: addr.state || "",
          zip: addr.zip || "",
          country: "US",
          phone: phone.areaCode
            ? `${phone.areaCode}-${(phone.number || "").trim()}`
            : "",
          latitude: r.latitude || "",
          longitude: r.longitude || "",
          storeType: store.storeType || "",
          storeHours: `${store.storeOpenTime || ""}-${store.storeCloseTime || ""}`,
          pharmacyHours: `${store.pharmacyOpenTime || ""}-${store.pharmacyCloseTime || ""}`,
          services: (store.serviceIndicators || [])
            .map((s) => s.name)
            .join(", "),
        };
      });
    },
  },

  publix: {
    name: "Publix",
    type: "storepoint", // single call gets all ~1,435 stores
    url: "https://services.publix.com/api/v1/storelocation",
    params: {
      types: "R,G,H,N,S",
      limit: 5000,
      latitude: 28.5383,
      longitude: -81.3792,
      distance: 5000,
    },
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    parseResponse(data) {
      return (data.Stores || []).map((d) => ({
        name: d.NAME || "",
        storeNumber: d.KEY || "",
        address: d.ADDR || "",
        city: d.CITY || "",
        state: d.STATE || "",
        zip: d.ZIP || "",
        country: "US",
        phone: d.PHONE || "",
        fax: d.FAX || "",
        latitude: d.CLAT || "",
        longitude: d.CLON || "",
        hours: d.STRHOURS || "",
        departments: d.DEPTS || "",
        services: d.SERVICES || "",
        storeType: d.TYPE || "",
      }));
    },
  },
  doitbest: {
    name: "Do It Best",
    type: "storepoint",
    url: "https://www.doitbest.com/api/graphql",
    params: {},
    headers: {
      "dibcommercerestriction":
        "OpuhXuFqP9pC6H7xuiXmLWGJVTyWTg4trfIBLqjIi97FDPIqJJ1nV0cRqpmOTRnL",
      Store: "default",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    fetchOverride: true,
    async fetchData() {
      const statesQuery =
        "{ activeMemberStates { state count } }";
      const res = await fetch(`${this.url}?query=${encodeURIComponent(statesQuery)}`, {
        headers: this.headers,
      });
      const statesData = await res.json();
      const states = statesData?.data?.activeMemberStates || [];
      const stateMap = {
        Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
        Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
        Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
        Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
        Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
        Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
        "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
        "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
        Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
        "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
        Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI",
        Wyoming: "WY", "District of Columbia": "DC", "Puerto Rico": "PR",
        "Virgin Islands": "VI", Guam: "GU", "American Samoa": "AS",
        "Northern Mariana Islands": "MP",
      };
      const allStores = [];
      for (const s of states) {
        const abbrev = stateMap[s.state] || s.state;
        const q = `{ storeLocator(filter: { state: "${abbrev}", limit: 1000 }) { store { name member_number street city state zipcode phone_number lat lng } } }`;
        const r = await fetch(`${this.url}?query=${encodeURIComponent(q)}`, {
          headers: this.headers,
        });
        const d = await r.json();
        const stores = d?.data?.storeLocator?.store || [];
        allStores.push(...stores);
        process.stdout.write(
          `\r  ${abbrev}: ${stores.length} stores | Total: ${allStores.length}`
        );
        await new Promise((r) => setTimeout(r, 300));
      }
      console.log();
      return allStores;
    },
    parseResponse(data) {
      return (Array.isArray(data) ? data : []).map((d) => ({
        name: d.name || "",
        memberId: d.member_number || "",
        address: d.street || "",
        city: d.city || "",
        state: d.state || "",
        zip: d.zipcode || "",
        country: "US",
        phone: d.phone_number || "",
        latitude: d.lat || "",
        longitude: d.lng || "",
      }));
    },
  },

  acehardware: {
    name: "Ace Hardware",
    type: "embedded",
    url: "https://www.acehardware.com/store-directory",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    extractDealers(html) {
      const marker = 'storeDirectory">[';
      const start = html.indexOf(marker);
      if (start === -1) throw new Error("Could not find store data in page");
      const arrStart = html.indexOf("[", start);
      let depth = 0;
      let inStr = false;
      let escape = false;
      for (let i = arrStart; i < html.length; i++) {
        const c = html[i];
        if (escape) { escape = false; continue; }
        if (c === "\\") { escape = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "[") depth++;
        else if (c === "]") {
          depth--;
          if (depth === 0) {
            let arrText = html.slice(arrStart, i + 1)
              .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">").replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'");
            return JSON.parse(arrText);
          }
        }
      }
      throw new Error("Could not parse store JSON array");
    },
    parseResponse(data) {
      return data
        .filter((d) => d.address?.countryCode === "US")
        .map((d) => ({
          name: d.name || "",
          storeCode: d.code || "",
          address: [d.address?.address1, d.address?.address2].filter(Boolean).join(" ").trim(),
          city: d.address?.cityOrTown || "",
          state: d.address?.stateOrProvince || "",
          zip: d.address?.postalOrZipCode || "",
          country: "US",
          phone: d.formattedPhoneNumber || d.phone || "",
        }));
    },
  },

  lowes: {
    name: "Lowe's",
    type: "storepoint",
    url: "https://www.lowes.com/Lowes-Stores",
    params: {},
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    fetchOverride: true,
    async fetchData() {
      const states = [
        "AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","IA","ID",
        "IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC",
        "ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD",
        "TN","TX","UT","VA","VT","WA","WI","WV","WY",
      ];
      const stateNames = {
        AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
        CO:"Colorado",CT:"Connecticut",DC:"District-Of-Columbia",DE:"Delaware",
        FL:"Florida",GA:"Georgia",HI:"Hawaii",IA:"Iowa",ID:"Idaho",IL:"Illinois",
        IN:"Indiana",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",MA:"Massachusetts",
        MD:"Maryland",ME:"Maine",MI:"Michigan",MN:"Minnesota",MO:"Missouri",
        MS:"Mississippi",MT:"Montana",NC:"North-Carolina",ND:"North-Dakota",
        NE:"Nebraska",NH:"New-Hampshire",NJ:"New-Jersey",NM:"New-Mexico",
        NV:"Nevada",NY:"New-York",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",
        PA:"Pennsylvania",RI:"Rhode-Island",SC:"South-Carolina",SD:"South-Dakota",
        TN:"Tennessee",TX:"Texas",UT:"Utah",VA:"Virginia",VT:"Vermont",
        WA:"Washington",WI:"Wisconsin",WV:"West-Virginia",WY:"Wyoming",
      };
      // Phase 1: Collect store IDs from state directory pages
      const storeIds = new Set();
      for (const st of states) {
        const name = stateNames[st] || st;
        const url = `${this.url}/${name}/${st}`;
        try {
          const res = await fetch(url, { headers: this.headers });
          const html = await res.text();
          const marker = '"storeDirectory":';
          const idx = html.indexOf(marker);
          if (idx !== -1) {
            const start = idx + marker.length;
            let depth = 0, inStr = false, esc = false;
            for (let i = start; i < html.length; i++) {
              const c = html[i];
              if (esc) { esc = false; continue; }
              if (c === "\\") { esc = true; continue; }
              if (c === '"') { inStr = !inStr; continue; }
              if (inStr) continue;
              if (c === "{") depth++;
              if (c === "}") {
                depth--;
                if (depth === 0) {
                  const dir = JSON.parse(html.slice(start, i + 1));
                  for (const city of Object.values(dir)) {
                    for (const s of city) storeIds.add(s.id);
                  }
                  break;
                }
              }
            }
          }
        } catch (e) {}
        process.stdout.write(`\r  Phase 1 — ${st}: ${storeIds.size} store IDs`);
        await new Promise((r) => setTimeout(r, 200));
      }
      console.log();

      // Phase 2: Fetch detail API for each store (has lat/lng)
      const allStores = [];
      const ids = [...storeIds];
      for (let i = 0; i < ids.length; i++) {
        try {
          const res = await fetch(
            `https://www.lowes.com/store/api/${ids[i]}`,
            { headers: { ...this.headers, accept: "application/json" } }
          );
          const d = await res.json();
          if (d && d.ADDR) allStores.push(d);
        } catch (e) {}
        if ((i + 1) % 50 === 0 || i === ids.length - 1) {
          process.stdout.write(`\r  Phase 2 — ${i + 1}/${ids.length} detail pages | ${allStores.length} stores`);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      console.log();
      return allStores;
    },
    parseResponse(data) {
      return (Array.isArray(data) ? data : []).map((d) => ({
        name: `Lowe's ${d.CITY || d.city || ""}`.trim(),
        storeId: d.storeNumber || "",
        address: d.ADDR || "",
        city: d.CITY || "",
        state: d.STATE || "",
        zip: d.ZIP || "",
        country: "US",
        phone: d.PHONE || "",
        latitude: d.LLAT || "",
        longitude: d.LLON || "",
      }));
    },
  },

  carterlumber: {
    name: "Carter Lumber",
    type: "storepoint",
    url: "https://www.carterlumber.com/api/content/_search",
    params: {},
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    fetchOverride: true,
    async fetchData() {
      const res = await fetch(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          query: "+contentType:Location",
          sort: "modDate",
          limit: -1,
        }),
      });
      const data = await res.json();
      return data?.entity?.jsonObjectView?.contentlets || [];
    },
    parseResponse(data) {
      return (Array.isArray(data) ? data : []).map((d) => ({
        name: d.storeName || d.title || "",
        storeNumber: d.posNumber || "",
        address: d.addressLines || "",
        city: d.city || "",
        state: d.state || "",
        zip: d.zip || "",
        country: "US",
        phone: d.phoneNumber || "",
        latitude: d.latitude || "",
        longitude: d.longitude || "",
        manager: d.manager || "",
        market: d.market || "",
      }));
    },
  },

  hilti: {
    name: "Hilti",
    type: "storepoint",
    url: "https://www.hilti.com/stores",
    params: {},
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    fetchOverride: true,
    async fetchData() {
      // Step 1: Get all store slugs from directory page
      const res = await fetch(this.url, { headers: this.headers });
      const html = await res.text();
      const slugs = [...html.matchAll(/\/stores\/([a-z_-]+)/g)]
        .map((m) => m[1])
        .filter((s, i, a) => a.indexOf(s) === i);
      console.log(`  Found ${slugs.length} store pages`);

      // Step 2: Fetch each store detail page for JSON-LD
      const allStores = [];
      for (let i = 0; i < slugs.length; i++) {
        const r = await fetch(`${this.url}/${slugs[i]}`, { headers: this.headers });
        const h = await r.text();
        // Extract JSON-LD
        const ldMatch = h.match(/<script type="application\/ld\+json">\s*(\{[\s\S]*?"@type"\s*:\s*"Store"[\s\S]*?\})\s*<\/script>/);
        if (ldMatch) {
          try {
            const ld = JSON.parse(ldMatch[1]);
            allStores.push({ ...ld, slug: slugs[i] });
          } catch (e) {}
        }
        process.stdout.write(`\r  Fetched ${i + 1}/${slugs.length} stores`);
        await new Promise((r) => setTimeout(r, 300));
      }
      console.log();
      return allStores;
    },
    parseResponse(data) {
      return (Array.isArray(data) ? data : []).map((d) => {
        const addr = d.address || {};
        const geo = d.geo || {};
        return {
          name: d.name || d.slug || "",
          address: addr.streetAddress || "",
          city: addr.addressLocality || "",
          state: addr.addressRegion || "",
          zip: addr.postalCode || "",
          country: "US",
          phone: d.telephone || "",
          latitude: geo.latitude || "",
          longitude: geo.longitude || "",
        };
      });
    },
  },

  aubuchon: {
    name: "Aubuchon Hardware",
    type: "storepoint",
    url: "https://www.hardwarestore.com/graphql",
    params: {},
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    fetchOverride: true,
    async fetchData() {
      const query = `{ pickupStoreList { store_number store_name address city region_code zipcode latitude longitude phone brand { name } } }`;
      const res = await fetch(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      return data?.data?.pickupStoreList || [];
    },
    parseResponse(data) {
      return (Array.isArray(data) ? data : []).map((d) => ({
        name: d.store_name || "",
        storeNumber: d.store_number || "",
        brand: d.brand?.name || "",
        address: d.address || "",
        city: d.city || "",
        state: d.region_code || "",
        zip: d.zipcode || "",
        country: "US",
        phone: d.phone || "",
        latitude: d.latitude || "",
        longitude: d.longitude || "",
      }));
    },
  },

  homedepot: {
    name: "Home Depot",
    type: "storepoint",
    url: "https://places.googleapis.com/v1/places:searchText",
    params: {},
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.id",
    },
    fetchOverride: true,
    async fetchData() {
      const seen = new Set();
      const allStores = [];
      const { ZIP_GRID } = await import("./zip-grid.js");
      for (let i = 0; i < ZIP_GRID.length; i++) {
        const zip = ZIP_GRID[i];
        try {
          const res = await fetch(this.url, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify({
              textQuery: `Home Depot near ${zip}`,
              maxResultCount: 20,
            }),
          });
          const data = await res.json();
          const places = data.places || [];
          for (const p of places) {
            if (p.id && !seen.has(p.id)) {
              seen.add(p.id);
              allStores.push(p);
            }
          }
        } catch (e) {}
        if ((i + 1) % 50 === 0 || i === ZIP_GRID.length - 1) {
          process.stdout.write(`\r  ${i + 1}/${ZIP_GRID.length} zips | ${allStores.length} unique stores`);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      console.log();
      return allStores;
    },
    parseResponse(data) {
      return (Array.isArray(data) ? data : []).map((p) => {
        const addr = p.formattedAddress || "";
        const parts = addr.split(", ");
        // Typical: "123 Main St, City, ST 12345, USA"
        const street = parts[0] || "";
        const city = parts[1] || "";
        const stateZip = (parts[2] || "").split(" ");
        const state = stateZip[0] || "";
        const zip = stateZip[1] || "";
        return {
          name: p.displayName?.text || "",
          placeId: p.id || "",
          address: street,
          city,
          state,
          zip,
          country: "US",
          phone: p.nationalPhoneNumber || "",
          latitude: p.location?.latitude || "",
          longitude: p.location?.longitude || "",
        };
      });
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

  if (config.sample && !process.argv.includes("--force")) {
    console.log(`\n⚠ ${config.name} is marked as sample-only (too heavy for weekly cron).`);
    console.log(`  Run with --force to scrape anyway: node scrape.js ${configName} --force`);
    process.exit(0);
  }

  console.log(`\nScraping ${config.name}...`);
  console.log(`Type: ${config.type}\n`);

  let allDealers = [];

  if (config.type === "embedded") {
    // Fetch a page and extract embedded JSON data
    console.log(`Fetching: ${config.url}`);
    const res = await fetch(config.url, { headers: config.headers || {} });
    const html = await res.text();
    console.log(`Page size: ${(html.length / 1024).toFixed(0)} KB`);

    const rawDealers = config.extractDealers(html);
    allDealers = config.parseResponse(rawDealers);
    console.log(`Extracted ${allDealers.length} dealers from embedded data.`);
  } else if (config.type === "storepoint") {
    // Single API call gets everything
    let data;
    if (config.fetchOverride && config.fetchData) {
      console.log(`Fetching: ${config.url} (custom)`);
      data = await config.fetchData();
    } else {
      const params = new URLSearchParams(
        Object.entries(config.params).map(([k, v]) => [k, String(v)])
      );
      const url = `${config.url}?${params}`;
      console.log(`Fetching: ${url}`);
      const res = await fetch(url, { headers: config.headers || {} });
      data = await res.json();
    }
    allDealers = config.parseResponse(data);
    console.log(`Got ${allDealers.length} dealers in single request.`);
  } else if (config.type === "paginated") {
    // Paginate through a REST API with offset/limit
    let offset = 0;
    let hasMore = true;
    let errors = 0;

    while (hasMore) {
      const url = `${config.baseUrl}?limit=${config.pageSize}&offset=${offset}`;
      try {
        const res = await fetch(url, {
          headers: typeof config.headers === "function" ? config.headers() : config.headers || {},
        });
        const data = await res.json();
        const items = data.result?.items || [];

        if (items.length === 0) {
          hasMore = false;
          break;
        }

        for (const item of items) {
          if (config.filterItem && !config.filterItem(item)) continue;
          allDealers.push(config.parseItem(item));
        }

        offset += items.length;
        process.stdout.write(
          `\r  Fetched ${offset} records | ${allDealers.length} matching filter`
        );

        if (items.length < config.pageSize) {
          hasMore = false;
        }

        await sleep(200);
      } catch (e) {
        errors++;
        console.log(`\n  Error at offset ${offset}: ${e.message}`);
        if (errors > 5) {
          console.log("  Too many errors, stopping.");
          hasMore = false;
        }
        await sleep(1000);
      }
    }
    console.log();
  } else if (config.type === "zipgrid") {
    // Search from a grid of zip codes
    const totalZips = ZIP_GRID.length;
    let completed = 0;
    let errors = 0;

    const BATCH_SIZE = config.batchSize || 5;
    const DELAY_BETWEEN_BATCHES_MS = config.delayMs || 1000;

    for (let i = 0; i < ZIP_GRID.length; i += BATCH_SIZE) {
      const batch = ZIP_GRID.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (zip) => {
          const req = config.buildRequest(zip);
          const res = await fetch(req.url, req.options);
          if (config.parseHtml) {
            const html = await res.text();
            const rawDealers = config.extractFromHtml(html);
            return config.parseResponse(rawDealers);
          }
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

      if (completed % 50 < BATCH_SIZE) {
        const uniqueSoFar = dedup(allDealers).length;
        process.stdout.write(
          `\r  Progress: ${completed}/${totalZips} zips | ${allDealers.length} raw | ${uniqueSoFar} unique | ${errors} errors`
        );
      }

      if (i + BATCH_SIZE < ZIP_GRID.length) {
        await sleep(DELAY_BETWEEN_BATCHES_MS);
      }
    }
    console.log();
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
          // Support custom fetchAndParse (e.g., Toro HTML parsing)
          if (config.fetchAndParse) {
            const url = config.buildUrl(point.lat, point.lng);
            const rawDealers = await config.fetchAndParse(url);
            return config.parseResponse(rawDealers);
          }
          // Support buildRequest for POST-based APIs (e.g., Kubota)
          let url, fetchOpts;
          if (config.buildRequest) {
            const req = config.buildRequest(point.lat, point.lng);
            url = req.url;
            fetchOpts = req.options;
          } else {
            url = config.buildUrl(point.lat, point.lng);
            fetchOpts = { headers: config.headers || {} };
          }
          const res = await fetch(url, fetchOpts);
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
    const tag = config.sample ? " [sample-only]" : "";
    console.log(`  ${key} - ${config.name} (${config.type})${tag}`);
  }
  console.log("\nUsage: node scrape.js <config-name>");
  process.exit(0);
}

await scrape(arg);
