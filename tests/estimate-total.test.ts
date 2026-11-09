import { describe, expect, it } from "vitest";
import { TollCalculationService } from "../lib/toll/calculation-service";

describe("estimated toll totals", () => {
  it("returns a total for a low-confidence third-party match while requiring verification", async () => {
    const service = new TollCalculationService(async () => ({ centavos: 31400, estimate: true }));
    const result = await service.calculate([{ expressway: "NLEX", entry: "San Fernando", exit: "Valenzuela", confidence: "LOW" }], "CLASS_1", new Date());
    expect(result.totalCentavos).toBe(31400);
    expect(result.status).toBe("ESTIMATED");
  });
});
