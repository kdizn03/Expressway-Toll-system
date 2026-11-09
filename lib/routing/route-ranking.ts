import type { TollCalculationStatus } from "@/lib/toll/types";

export type RoutePreference = "FASTEST" | "CHEAPEST" | "BALANCED";
export type RankableRoute = { id: string; durationSeconds: number; distanceMeters: number; toll: { totalCentavos?: number; status: TollCalculationStatus } };

/** Documented, configurable balanced-route weights. They total 1.0. */
export const BALANCED_WEIGHTS = { duration: 0.5, distance: 0.2, toll: 0.3 } as const;

const normalize = (value: number, minimum: number, maximum: number) => maximum === minimum ? 0 : (value - minimum) / (maximum - minimum);

export function rankRouteAlternatives<T extends RankableRoute>(routes: T[]) {
  if (routes.length === 0) return { ordered: [] as T[], unavailable: ["FASTEST", "CHEAPEST", "BALANCED"] as RoutePreference[], labels: new Map<string, RoutePreference[]>() };
  const fastest = [...routes].sort((a, b) => a.durationSeconds - b.durationSeconds)[0];
  const verified = routes.filter((route) => route.toll.status === "VERIFIED" && route.toll.totalCentavos !== undefined);
  const cheapest = verified.length > 0 ? [...verified].sort((a, b) => (a.toll.totalCentavos ?? Infinity) - (b.toll.totalCentavos ?? Infinity))[0] : undefined;
  const withAmounts = routes.filter((route) => route.toll.totalCentavos !== undefined);
  const durationValues = routes.map((route) => route.durationSeconds);
  const distanceValues = routes.map((route) => route.distanceMeters);
  const tollValues = withAmounts.map((route) => route.toll.totalCentavos ?? 0);
  const balanced = [...routes].sort((a, b) => {
    const score = (route: T) => {
      const missingTollPenalty = route.toll.totalCentavos === undefined ? 1 : 0;
      return BALANCED_WEIGHTS.duration * normalize(route.durationSeconds, Math.min(...durationValues), Math.max(...durationValues))
        + BALANCED_WEIGHTS.distance * normalize(route.distanceMeters, Math.min(...distanceValues), Math.max(...distanceValues))
        + BALANCED_WEIGHTS.toll * (route.toll.totalCentavos === undefined ? 1 : normalize(route.toll.totalCentavos, Math.min(...tollValues), Math.max(...tollValues)))
        + missingTollPenalty;
    };
    return score(a) - score(b);
  })[0];
  const labels = new Map<string, RoutePreference[]>();
  for (const [route, label] of [[fastest, "FASTEST"], [cheapest, "CHEAPEST"], [balanced, "BALANCED"]] as const) {
    if (!route) continue;
    labels.set(route.id, [...(labels.get(route.id) ?? []), label]);
  }
  const ordered = [...routes].sort((a, b) => {
    const aRank = labels.has(a.id) ? Math.min(...(labels.get(a.id) ?? []).map((label) => ["FASTEST", "CHEAPEST", "BALANCED"].indexOf(label))) : 99;
    const bRank = labels.has(b.id) ? Math.min(...(labels.get(b.id) ?? []).map((label) => ["FASTEST", "CHEAPEST", "BALANCED"].indexOf(label))) : 99;
    return aRank - bRank || a.durationSeconds - b.durationSeconds;
  });
  return { ordered, unavailable: cheapest ? [] : ["CHEAPEST"] as RoutePreference[], labels };
}
