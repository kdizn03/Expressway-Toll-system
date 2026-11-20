import type { TollEstimate, TollSegment, VehicleCode } from "./types";
/** `exitExpressway` is set when one integrated fare spans two connected expressways (e.g. NLEX → SCTEX). */
export type MatchedRoad = { expressway:string; exitExpressway?:string; entry:string; exit:string; confidence:TollSegment["confidence"] };
export type RateLookup = (road:MatchedRoad, vehicle:VehicleCode, at:Date)=>Promise<{centavos?:number;version?:string;effectiveFrom?:Date;lastVerifiedAt?:Date|null;source?:string;sourceUrl?:string;estimate?:boolean;isFree?:boolean;unavailableReason?:string}|undefined>;

/**
 * Connected expressways that are tolled as one through-trip: the fare from an NLEX entry to an
 * SCTEX exit (or Skyway to SLEX) is a single matrix amount, not the sum of two separate trips.
 */
const INTEGRATED_SYSTEMS = new Set(["NLEX>SCTEX", "SCTEX>NLEX", "SKYWAY>SLEX", "SLEX>SKYWAY"]);
const confidenceRank = { HIGH: 2, MEDIUM: 1, LOW: 0 } as const;
const lowerConfidence = (a: TollSegment["confidence"], b: TollSegment["confidence"]) => confidenceRank[a] <= confidenceRank[b] ? a : b;

/** Pure orchestration: geometry matching is injected, keeping provider and PostGIS details outside pricing. */
export class TollCalculationService {
  constructor(private readonly lookup:RateLookup) {}

  /** Replaces adjacent segments of an integrated system with one through-trip when a rate for it exists. */
  private async mergeIntegrated(roads:MatchedRoad[], vehicle:VehicleCode, at:Date):Promise<MatchedRoad[]>{
    const merged: MatchedRoad[] = [];
    for (const road of roads) {
      const previous = merged.at(-1);
      if (previous && !previous.exitExpressway && !road.exitExpressway && INTEGRATED_SYSTEMS.has(`${previous.expressway}>${road.expressway}`)) {
        const through: MatchedRoad = { expressway: previous.expressway, exitExpressway: road.expressway, entry: previous.entry, exit: road.exit, confidence: lowerConfidence(previous.confidence, road.confidence) };
        const rate = await this.lookup(through, vehicle, at);
        if (rate?.centavos !== undefined && rate.centavos > 0) { merged[merged.length - 1] = through; continue; }
      }
      merged.push(road);
    }
    return merged;
  }

  async calculate(matchedRoads:MatchedRoad[], vehicle:VehicleCode, at:Date, roundTrip=false):Promise<TollEstimate>{
    const roads = await this.mergeIntegrated(matchedRoads, vehicle, at);
    const seen = new Set<string>();
    const duplicateWarnings: string[] = [];
    const uniqueRoads = roads.filter((road) => {
      const key = `${road.expressway}|${road.exitExpressway ?? ""}|${road.entry}|${road.exit}`;
      if (!seen.has(key)) { seen.add(key); return true; }
      duplicateWarnings.push(`Duplicate ${road.expressway} segment (${road.entry} → ${road.exit}) was ignored.`);
      return false;
    });
    if (uniqueRoads.length === 0) return { segments: [], status: "UNAVAILABLE", disclaimer: "No supported toll-road segment could be identified for this route.", warnings: duplicateWarnings };
    const segments=await Promise.all(uniqueRoads.map(async road=>{
      const rate=await this.lookup(road,vehicle,at);
      const invalidAmount = rate?.centavos !== undefined && (!Number.isInteger(rate.centavos) || rate.centavos < 0 || (rate.centavos === 0 && !rate.isFree));
      return {...road,vehicleClass:vehicle,tollCentavos:invalidAmount?undefined:rate?.centavos,rateVersion:rate?.version,effectiveFrom:rate?.effectiveFrom,lastVerifiedAt:rate?.lastVerifiedAt,source:rate?.source,sourceUrl:rate?.sourceUrl,estimate:rate?.estimate,warning:rate?.unavailableReason??(invalidAmount?"The source supplied an invalid zero or negative toll amount.":!rate?"No rate is available for this plaza pair.":road.confidence==="LOW"?"Route match needs verification.":rate?.estimate?"Third-party matrix estimate; verify before travel.":undefined)};
    }));
    const incomplete=segments.some(s=>s.tollCentavos===undefined);
    const sum=segments.reduce((n,s)=>n+(s.tollCentavos??0),0)*(roundTrip?2:1);
    if (incomplete) return {segments,status:"INCOMPLETE",disclaimer:"One or more identified toll segments could not be calculated. Review the segment breakdown before travel.",warnings:duplicateWarnings};
    const estimated = segments.some((segment) => segment.estimate || segment.confidence !== "HIGH");
    return {segments,totalCentavos:sum,status:estimated?"ESTIMATED":"VERIFIED",disclaimer:estimated?"This total contains a third-party rate or a plaza match that requires verification.":"All identified toll segments use published verified rate data.",warnings:duplicateWarnings};
  }
}
