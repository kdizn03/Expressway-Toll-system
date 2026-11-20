// Builds lib/geo/philippines-boundary.json from a Natural Earth 1:10m Admin-0 Countries GeoJSON.
// Usage: node scripts/extract-philippines-boundary.mjs <ne_10m_admin_0_countries.geojson> lib/geo/philippines-boundary.json
//
// Output:
//   rings             – outer rings of Philippine land (ADM0_A3 = PHL)
//   archipelagoHull   – convex hull of that land (counter-clockwise); approximates the archipelagic waters
//   foreignLandInHull – every other country's land clipped to the hull, so it can be excluded
import { readFileSync, writeFileSync } from "node:fs";

const [input, output, version = "5.1.2"] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: extract-philippines-boundary.mjs <input.geojson> <output.json> [version]");
const data = JSON.parse(readFileSync(input, "utf8"));
const round = (value) => Math.round(value * 1e5) / 1e5;
const outerRings = (feature) => { const g = feature.geometry; return (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((polygon) => polygon[0]); };

const philippines = data.features.filter((feature) => feature.properties.ADM0_A3 === "PHL");
if (philippines.length !== 1) throw new Error(`expected one PHL feature, found ${philippines.length}`);
const rings = outerRings(philippines[0]).map((ring) => ring.map(([x, y]) => [round(x), round(y)]));

// Andrew's monotone chain convex hull (counter-clockwise).
const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const points = rings.flat().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const half = (list) => { const out = []; for (const p of list) { while (out.length >= 2 && cross(out.at(-2), out.at(-1), p) <= 0) out.pop(); out.push(p); } return out; };
const lower = half(points); const upper = half([...points].reverse());
const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];

// Sutherland–Hodgman clipping of a ring against the convex hull.
const clip = (ring) => {
  let result = ring.slice(0, -1);
  for (let i = 0; i < hull.length && result.length; i++) {
    const a = hull[i]; const b = hull[(i + 1) % hull.length]; const input = result; result = [];
    const inside = (p) => cross(a, b, p) >= 0;
    const intersect = (p, q) => { const t = cross(a, b, p) / (cross(a, b, p) - cross(a, b, q)); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
    for (let j = 0; j < input.length; j++) {
      const current = input[j]; const previous = input[(j + input.length - 1) % input.length];
      if (inside(current)) { if (!inside(previous)) result.push(intersect(previous, current)); result.push(current); }
      else if (inside(previous)) result.push(intersect(previous, current));
    }
  }
  return result.length >= 3 ? [...result, result[0]].map(([x, y]) => [round(x), round(y)]) : undefined;
};
const foreignLandInHull = [];
for (const feature of data.features) {
  if (feature.properties.ADM0_A3 === "PHL") continue;
  for (const ring of outerRings(feature)) {
    const clipped = clip(ring);
    if (clipped) foreignLandInHull.push({ country: feature.properties.ADM0_A3, ring: clipped });
  }
}

const result = {
  source: `Natural Earth 1:10m Cultural Vectors, Admin 0 – Countries, v${version} (public domain)`,
  sourceUrl: `https://github.com/nvkelso/natural-earth-vector/blob/v${version}/geojson/ne_10m_admin_0_countries.geojson`,
  rings,
  archipelagoHull: hull,
  foreignLandInHull,
};
writeFileSync(output, JSON.stringify(result));
console.log({ polygons: rings.length, vertices: rings.reduce((n, r) => n + r.length, 0), hullVertices: hull.length, foreignClipped: foreignLandInHull.map((item) => `${item.country}:${item.ring.length}`), bytes: JSON.stringify(result).length });
