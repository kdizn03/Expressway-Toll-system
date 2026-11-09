import { describe, expect, it } from "vitest";
import { matchedEntryName } from "../lib/toll/tplex-entry";

describe("TPLEX northern entry matching", () => {
  it("uses Rosario for a southbound trip originating in Baguio", () => {
    expect(matchedEntryName("TPLEX", 16.41, 16.16, 16.01, "Sison")).toBe("Rosario");
  });

  it("does not override routes that begin within the TPLEX corridor", () => {
    expect(matchedEntryName("TPLEX", 16.05, 16.05, 16.01, "Sison")).toBe("Sison");
  });
});
