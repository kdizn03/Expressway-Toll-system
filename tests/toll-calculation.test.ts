import { describe,it,expect } from "vitest";
import { TollCalculationService } from "../lib/toll/calculation-service";
describe("TollCalculationService",()=>{it("sums multi-expressway tolls and respects round trips",async()=>{const service=new TollCalculationService(async road=>({centavos:road.expressway==="TPLEX"?15000:8000,version:"v1"}));const r=await service.calculate([{expressway:"TPLEX",entry:"A",exit:"B",confidence:"HIGH"},{expressway:"SCTEX",entry:"B",exit:"C",confidence:"HIGH"}],"CLASS_1",new Date(),true);expect(r.totalCentavos).toBe(46000);expect(r.status).toBe("VERIFIED");});it("does not state an exact total for an unmatched rate",async()=>{const s=new TollCalculationService(async()=>undefined);const r=await s.calculate([{expressway:"NLEX",entry:"A",exit:"B",confidence:"HIGH"}],"CLASS_1",new Date());expect(r.totalCentavos).toBeUndefined();expect(r.status).toBe("INCOMPLETE");});});

describe("integrated NLEX–SCTEX and Skyway–SLEX fares", () => {
  // Class 1 matrix values: Balintawak → Sta. Ines ₱440, Mabalacat → Tipo ₱370, but Balintawak → Tipo is ₱857 as one trip.
  const lookup = async (road: { expressway: string; exitExpressway?: string; entry: string; exit: string }) => {
    if (road.exitExpressway === "SCTEX" && road.entry === "Balintawak" && road.exit === "Tipo") return { centavos: 85700, estimate: true };
    if (road.exitExpressway) return undefined;
    return { centavos: road.expressway === "NLEX" ? 44000 : 37000, estimate: true };
  };

  it("prices an NLEX entry to an SCTEX exit as one through-trip instead of summing two trips", async () => {
    const result = await new TollCalculationService(lookup).calculate([
      { expressway: "NLEX", entry: "Balintawak", exit: "Sta. Ines", confidence: "HIGH" },
      { expressway: "SCTEX", entry: "Mabalacat", exit: "Tipo", confidence: "MEDIUM" },
    ], "CLASS_1", new Date());
    expect(result.totalCentavos).toBe(85700);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ expressway: "NLEX", exitExpressway: "SCTEX", entry: "Balintawak", exit: "Tipo", confidence: "MEDIUM" });
  });

  it("keeps separate segments when no integrated rate exists", async () => {
    const result = await new TollCalculationService(lookup).calculate([
      { expressway: "NLEX", entry: "Valenzuela", exit: "Sta. Ines", confidence: "HIGH" },
      { expressway: "SCTEX", entry: "Mabalacat", exit: "Tipo", confidence: "HIGH" },
    ], "CLASS_1", new Date());
    expect(result.segments.map((segment) => segment.expressway)).toEqual(["NLEX", "SCTEX"]);
    expect(result.totalCentavos).toBe(81000);
  });

  it("never merges expressways run by different operators", async () => {
    const calls: string[] = [];
    await new TollCalculationService(async (road) => { calls.push(`${road.expressway}>${road.exitExpressway ?? ""}`); return { centavos: 100 }; }).calculate([
      { expressway: "TPLEX", entry: "Rosario", exit: "La Paz", confidence: "HIGH" },
      { expressway: "SCTEX", entry: "Tarlac", exit: "Mabalacat", confidence: "HIGH" },
    ], "CLASS_1", new Date());
    expect(calls.some((call) => call.startsWith("TPLEX>SCTEX"))).toBe(false);
  });
});
