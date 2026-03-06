/**
 * Quick test: hit STIHL API directly with a few lat/lng points to verify it works
 */

const testPoints = [
  { name: "Atlanta", lat: 33.749, lng: -84.388 },
  { name: "New York", lat: 40.7128, lng: -74.006 },
  { name: "Chicago", lat: 41.8781, lng: -87.6298 },
  { name: "LA", lat: 34.0522, lng: -118.2437 },
  { name: "Houston", lat: 29.7604, lng: -95.3698 },
];

const headers = {
  accept: "application/json",
  "content-type": "application/json",
  "accept-language": "en-US",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  referer: "https://www.stihlusa.com/",
};

let totalRaw = 0;
const allDealers = new Map();

for (const point of testPoints) {
  const url = `https://252092-stihl-b2camer.adobeioruntime.net/apis/us-b2c/dealerdatahub/search?text=&latitude=${point.lat}&longitude=${point.lng}&distance=50&size=500&countrysearch=us,pr,gu,as,vi&units=imperial`;

  const res = await fetch(url, { headers });
  const data = await res.json();
  const count = data.dealers?.length || 0;
  const total = data.paginginfo?.totalcount || count;

  totalRaw += count;

  for (const d of data.dealers || []) {
    const key = `${d.accountNumber || d.name}`;
    if (!allDealers.has(key)) {
      allDealers.set(key, d);
    }
  }

  console.log(
    `${point.name}: ${count} dealers returned (${total} total in radius)`
  );
}

console.log(`\nRaw total: ${totalRaw}`);
console.log(`Unique dealers: ${allDealers.size}`);

// Show a sample
const sample = Array.from(allDealers.values())[0];
if (sample) {
  console.log(`\nSample dealer fields: ${Object.keys(sample).join(", ")}`);
  console.log(`Sample: ${sample.name} | ${sample.houseNumber} ${sample.street} | ${sample.city}, ${sample.region} ${sample.zip} | ${sample.businessPhone}`);
}
