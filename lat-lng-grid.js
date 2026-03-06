/**
 * Pre-computed lat/lng grid covering the continental US + Alaska + Hawaii
 * Spaced ~70 miles apart (1 degree lat ≈ 69 miles) for 50-mile radius overlap
 * This avoids the need to geocode zip codes entirely.
 */

function generateGrid() {
  const points = [];

  // Continental US: lat 25-49, lng -125 to -67
  for (let lat = 25; lat <= 49; lat += 0.9) {
    for (let lng = -124; lng <= -67; lng += 1.1) {
      points.push({ lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 });
    }
  }

  // Alaska: lat 55-71, lng -170 to -130
  for (let lat = 55; lat <= 71; lat += 1.5) {
    for (let lng = -170; lng <= -130; lng += 2.0) {
      points.push({ lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 });
    }
  }

  // Hawaii: lat 19-22, lng -160 to -155
  for (let lat = 19; lat <= 22; lat += 1.0) {
    for (let lng = -160; lng <= -155; lng += 1.0) {
      points.push({ lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 });
    }
  }

  // Puerto Rico / US Virgin Islands
  points.push({ lat: 18.2, lng: -66.5 });
  points.push({ lat: 18.3, lng: -65.0 });

  // Guam
  points.push({ lat: 13.4, lng: 144.8 });

  // American Samoa
  points.push({ lat: -14.3, lng: -170.7 });

  return points;
}

export const LAT_LNG_GRID = generateGrid();
