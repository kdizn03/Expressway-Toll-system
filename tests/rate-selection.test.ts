import { describe, expect, it } from "vitest";
import { selectEffectiveRate } from "../lib/toll/rate-selection";

const rates = [
  { id: "old", status: "PUBLISHED" as const, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-06-30"), cents: 100 },
  { id: "new", status: "PUBLISHED" as const, effectiveFrom: new Date("2026-07-01"), effectiveTo: null, cents: 200 },
  { id: "draft", status: "DRAFT" as const, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, cents: 1 },
];
describe("selectEffectiveRate", () => {
  it("selects historical and future-effective published versions by travel date", () => {
    expect(selectEffectiveRate(rates, new Date("2026-03-01"))?.id).toBe("old");
    expect(selectEffectiveRate(rates, new Date("2026-08-01"))?.id).toBe("new");
  });
  it("does not select a draft or unavailable rate", () => expect(selectEffectiveRate(rates, new Date("2025-12-01"))).toBeUndefined());
});
