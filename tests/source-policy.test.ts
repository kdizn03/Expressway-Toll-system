import { describe, expect, it } from "vitest";
import { isCustomerFacingSource } from "../lib/toll/source-policy";

describe("source publication policy", () => {
  it("allows only primary regulator or operator sources to supply customer fees", () => {
    expect(isCustomerFacingSource("official_regulator")).toBe(true);
    expect(isCustomerFacingSource("official_operator_disclosure")).toBe(true);
    expect(isCustomerFacingSource("secondary_matrix_reference")).toBe(false);
  });
});
