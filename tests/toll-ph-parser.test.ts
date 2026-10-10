import { describe, expect, it } from "vitest";
import { parseTollPhMatrix } from "../lib/toll-import/toll-ph.js";

const sample = `Last updated: July 27, 2026 toll_matrix:{entryPointId:1,exitPointId:2,fee:"52.50",reversible:true,vehicleClass:1},entryPoint:{id:1,name:"Entry Plaza",keywords:null,expresswayId:"NLEX",sequence:1},exitPoint:{id:2,name:"Exit Plaza",keywords:null,expresswayId:"NLEX",sequence:2}`;

describe("Toll.ph matrix parser", () => {
  it("converts a serialized matrix row into centavos without inventing its reverse direction", () => {
    const result = parseTollPhMatrix(sample, { minimumRows: 1 });
    expect(result.rows).toEqual([{
      entryExpresswayCode: "NLEX",
      exitExpresswayCode: "NLEX",
      entryName: "Entry Plaza",
      exitName: "Exit Plaza",
      vehicleClassCode: "CLASS_1",
      tollCentavos: 5250,
      reversible: true,
    }]);
    expect(result.reportedUpdatedAt?.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });
});
