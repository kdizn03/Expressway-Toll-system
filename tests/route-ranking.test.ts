import { describe, expect, it } from "vitest";
import { rankRouteAlternatives } from "../lib/routing/route-ranking";

describe("route ranking", () => {
  const routes = [
    { id: "fast", durationSeconds: 100, distanceMeters: 10000, toll: { totalCentavos: 20000, status: "VERIFIED" as const } },
    { id: "cheap", durationSeconds: 140, distanceMeters: 9000, toll: { totalCentavos: 10000, status: "VERIFIED" as const } },
    { id: "missing", durationSeconds: 110, distanceMeters: 9500, toll: { status: "INCOMPLETE" as const } },
  ];
  it("does not select an incomplete route as cheapest", () => {
    const ranked = rankRouteAlternatives(routes);
    expect(ranked.labels.get("fast")).toContain("FASTEST");
    expect(ranked.labels.get("cheap")).toContain("CHEAPEST");
  });
  it("reports cheapest as unavailable when no verified total exists", () => {
    const ranked = rankRouteAlternatives([{ ...routes[2], id: "only" }]);
    expect(ranked.unavailable).toContain("CHEAPEST");
  });
});
