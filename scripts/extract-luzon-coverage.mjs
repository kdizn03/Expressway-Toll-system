// Builds lib/geo/luzon-coverage.json from lib/geo/philippines-boundary.json (Natural Earth 1:10m).
// Usage: node scripts/extract-luzon-coverage.mjs [lib/geo/philippines-boundary.json] [lib/geo/luzon-coverage.json]
//
// Output:
//   luzon          – outer ring of the Luzon main island (the ring containing Manila)
//   nearbyIslands  – other Philippine land rings within 5 km of it (excluded from coverage even
//                    when inside the coastal tolerance, because they are separate islands)
import { readFileSync, writeFileSync } from "node:fs";

const [input = "lib/geo/philippines-boundary.json", output = "lib/geo/luzon-coverage.json"] = process.argv.slice(2);
const boundary = JSON.parse(readFileSync(input, "utf8"));
const inside = ([x, y], ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const segDist = (p, a, b) => { const kx = 111.32 * Math.cos(p[1] * Math.PI / 180), ky = 110.57; const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky; const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(ax + t * dx, ay + t * dy); };
const distanceToRing = (p, ring) => { let best = Infinity; for (let i = 1; i < ring.length; i++) best = Math.min(best, segDist(p, ring[i - 1], ring[i])); return best; };

const MANILA = [120.9842, 14.5995];
const luzonIndex = boundary.rings.findIndex((ring) => inside(MANILA, ring));
if (luzonIndex < 0) throw new Error("no ring contains Manila");
const luzon = boundary.rings[luzonIndex];
const nearbyIslands = boundary.rings.filter((ring, index) => index !== luzonIndex && Math.min(...ring.map((vertex) => distanceToRing(vertex, luzon))) < 5);

const result = { source: boundary.source, sourceUrl: boundary.sourceUrl, derivedFrom: "lib/geo/philippines-boundary.json", luzon, nearbyIslands };
writeFileSync(output, JSON.stringify(result));
console.log({ luzonVertices: luzon.length, nearbyIslands: nearbyIslands.map((ring) => ring.length), bytes: JSON.stringify(result).length });
