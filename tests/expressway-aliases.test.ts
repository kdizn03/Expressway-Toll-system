import { describe, expect, it } from "vitest";
import { identifyExpressway } from "../lib/toll/expressway-aliases";

describe("expressway alias precedence", () => {
  it("does not classify NLEX Connector as the broader NLEX road", () => {
    expect(identifyExpressway("NLEX-SLEX Connector Road")).toBe("NLEX_CONNECTOR");
  });
});
