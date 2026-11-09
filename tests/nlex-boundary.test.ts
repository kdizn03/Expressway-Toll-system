import { describe, expect, it } from "vitest";
import { nlexBoundaryPlazas, skywayStage3BoundaryPlazas } from "../lib/toll/nlex-boundary";

describe("NLEX corridor boundary matching", () => {
  it("uses Sta. Ines to Balintawak for a Baguio-to-Manila route", () => {
    expect(nlexBoundaryPlazas(16.4, 14.59, 15.21, 14.69, "Dau", "Karuhatan")).toEqual({ entry: "Sta. Ines", exit: "Balintawak" });
  });

  it("repairs a collapsed Stage 3 pair for a route from Northern Luzon", () => {
    expect(skywayStage3BoundaryPlazas(16.4, 14.65, 14.65, "E. Rodriguez", "E. Rodriguez")).toEqual({ entry: "Balintawak", exit: "E. Rodriguez" });
  });
});
