import type { TollEstimate, TollSegment, VehicleCode } from "./types";
export type MatchedRoad = { expressway:string; entry:string; exit:string; confidence:TollSegment["confidence"] };
export type RateLookup = (road:MatchedRoad, vehicle:VehicleCode, at:Date)=>Promise<{centavos:number;version:string}|undefined>;
/** Pure orchestration: geometry matching is injected, keeping provider and PostGIS details outside pricing. */
export class TollCalculationService {
  constructor(private readonly lookup:RateLookup) {}
  async calculate(roads:MatchedRoad[], vehicle:VehicleCode, at:Date, roundTrip=false):Promise<TollEstimate>{
    const segments=await Promise.all(roads.map(async road=>{const rate=await this.lookup(road,vehicle,at);return {...road,tollCentavos:rate?.centavos,rateVersion:rate?.version,warning:!rate?"No published rate is available for this plaza pair.":road.confidence==="LOW"?"Route match needs verification.":undefined}}));
    const incomplete=segments.some(s=>s.tollCentavos===undefined||s.confidence==="LOW");
    const sum=segments.reduce((n,s)=>n+(s.tollCentavos??0),0)*(roundTrip?2:1);
    return {segments,totalCentavos:incomplete?undefined:sum,status:incomplete?"VERIFICATION_REQUIRED":"VERIFIED",disclaimer:"Toll amounts are estimates based on the selected vehicle class, matched route, and published rate data. Actual charges may differ if your route changes."};
  }
}
