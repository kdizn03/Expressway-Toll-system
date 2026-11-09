import { describe, expect, it } from "vitest";
import { TollCalculationService } from "../lib/toll/calculation-service";

describe("toll calculation integrity", () => {
  const road = { expressway: "NLEX", entry: "San Fernando", exit: "Valenzuela", confidence: "HIGH" as const };

  it("does not charge a duplicate segment twice", async () => {
    const service = new TollCalculationService(async () => ({ centavos: 31400 }));
    const result = await service.calculate([road, road], "CLASS_1", new Date());
    expect(result.totalCentavos).toBe(31400);
    expect(result.warnings).toHaveLength(1);
  });

  it("rejects an unexplained zero toll instead of presenting it as free", async () => {
    const service = new TollCalculationService(async () => ({ centavos: 0 }));
    const result = await service.calculate([road], "CLASS_1", new Date());
    expect(result.status).toBe("INCOMPLETE");
    expect(result.totalCentavos).toBeUndefined();
  });

  it("allows an explicitly free segment", async () => {
    const service = new TollCalculationService(async () => ({ centavos: 0, isFree: true }));
    const result = await service.calculate([road], "CLASS_1", new Date());
    expect(result.status).toBe("VERIFIED");
    expect(result.totalCentavos).toBe(0);
  });
});
