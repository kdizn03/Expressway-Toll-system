import type { TollEstimate, TollSegment, VehicleCode } from "./types";
export type MatchedRoad = { expressway:string; entry:string; exit:string; confidence:TollSegment["confidence"] };
export type RateLookup = (road:MatchedRoad, vehicle:VehicleCode, at:Date)=>Promise<{centavos?:number;version?:string;effectiveFrom?:Date;lastVerifiedAt?:Date|null;source?:string;sourceUrl?:string;estimate?:boolean;unavailableReason?:string}|undefined>;
/** Pure orchestration: geometry matching is injected, keeping provider and PostGIS details outside pricing. */
export class TollCalculationService {
  constructor(private readonly lookup:RateLookup) {}
  async calculate(roads:MatchedRoad[], vehicle:VehicleCode, at:Date, roundTrip=false):Promise<TollEstimate>{
    const segments=await Promise.all(roads.map(async road=>{
      const rate=await this.lookup(road,vehicle,at);
      return {...road,tollCentavos:rate?.centavos,rateVersion:rate?.version,effectiveFrom:rate?.effectiveFrom,lastVerifiedAt:rate?.lastVerifiedAt,source:rate?.source,sourceUrl:rate?.sourceUrl,estimate:rate?.estimate,warning:rate?.unavailableReason??(!rate?"No rate is available for this plaza pair.":road.confidence==="LOW"?"Route match needs verification.":rate?.estimate?"Third-party matrix estimate; verify before travel.":undefined)};
    }));
    // A low-confidence plaza match is an estimate to review, not missing data.
    // Suppress the total only when an identified segment has no fee at all.
    const incomplete=segments.some(s=>s.tollCentavos===undefined);
    const sum=segments.reduce((n,s)=>n+(s.tollCentavos??0),0)*(roundTrip?2:1);
    const needsVerification = incomplete || segments.some((segment) => segment.estimate || segment.confidence === "LOW");
    return {segments,totalCentavos:incomplete?undefined:sum,status:needsVerification?"VERIFICATION_REQUIRED":"VERIFIED",disclaimer:"Toll amounts are estimates based on the selected vehicle class, matched route, and available rate data. Actual charges may differ if your route changes."};
  }
}
