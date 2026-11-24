/**
 * Runs representative Luzon trips through Google Routes + the toll matcher + the toll calculator for all
 * vehicle classes, and prints/saves the breakdown. Use before and after toll-data changes to compare.
 *
 *   npx tsx --env-file=.env scripts/toll-regression.ts [label]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { getDrivingRoutes } from "../lib/routing/google";
import { matchRouteToTolls } from "../lib/toll/route-matcher";
import { tollCalculationService } from "../lib/toll";
import type { VehicleCode } from "../lib/toll/types";

type Trip = [label: string, from: [number, number], to: [number, number]];
// [lng, lat] of well-known endpoints.
export const REGRESSION_TRIPS: Trip[] = [
  ["Baguio → Manila", [120.596, 16.4023], [120.9842, 14.5995]],
  ["Baguio → Clark", [120.596, 16.4023], [120.5466, 15.1855]],
  ["Manila → Tarlac City", [120.9842, 14.5995], [120.5963, 15.4755]],
  ["Manila → Subic", [120.9842, 14.5995], [120.2828, 14.8292]],
  ["Makati → Calamba", [121.0244, 14.5547], [121.1653, 14.2117]],
  ["Manila → Batangas City", [120.9842, 14.5995], [121.0583, 13.7565]],
  ["Manila → Lipa", [120.9842, 14.5995], [121.1633, 13.9411]],
  ["Manila → Kawit, Cavite", [120.9842, 14.5995], [120.9036, 14.4446]],
  ["Alabang → Silang (CALAX)", [121.0437, 14.4198], [120.9783, 14.2306]],
];
const classes: VehicleCode[] = ["CLASS_1", "CLASS_2", "CLASS_3"];

async function main() {
  const label = process.argv[2] ?? "run";
  const output: Record<string, unknown> = {};
  for (const [name, from, to] of REGRESSION_TRIPS) {
    await new Promise((resolve) => setTimeout(resolve, 4000)); // stay under the Routes API per-minute quota
    const routes = await getDrivingRoutes(from, to);
    const route = routes[0]; if (!route) { output[name] = "no route"; console.log(`${name}: no route`); continue; }
    const roads = await matchRouteToTolls(route);
    const perClass: Record<string, unknown> = {};
    for (const vehicle of classes) {
      const toll = await tollCalculationService.calculate(roads, vehicle, new Date(), false);
      perClass[vehicle] = { total: toll.totalCentavos === undefined ? null : toll.totalCentavos / 100, status: toll.status, segments: toll.segments.map((s) => `${s.expressway}${s.exitExpressway ? "–" + s.exitExpressway : ""} ${s.entry}→${s.exit} ${s.tollCentavos === undefined ? "N/A" : "₱" + s.tollCentavos / 100} ${s.verification ?? ""}${s.tollCentavos === undefined && s.warning ? " (" + s.warning + ")" : ""}`) };
    }
    output[name] = { km: Math.round(route.distanceMeters / 1000), ...perClass };
    const c1 = perClass.CLASS_1 as { total: number | null; status: string; segments: string[] };
    console.log(`\n${name} (${Math.round(route.distanceMeters / 1000)} km): C1 ${c1.total ?? "—"} [${c1.status}] C2 ${(perClass.CLASS_2 as { total: number | null }).total ?? "—"} C3 ${(perClass.CLASS_3 as { total: number | null }).total ?? "—"}\n   ${c1.segments.join("\n   ")}`);
  }
  mkdirSync("data/reports", { recursive: true });
  writeFileSync(`data/reports/toll-regression-${label}.json`, JSON.stringify(output, null, 1));
}
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
