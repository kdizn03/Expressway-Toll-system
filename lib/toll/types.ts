export type VehicleCode = "CLASS_1"|"CLASS_2"|"CLASS_3";
export type TollCalculationStatus = "VERIFIED"|"ESTIMATED"|"INCOMPLETE"|"UNAVAILABLE";
export type TollSegment = {
  expressway: string; exitExpressway?: string; entry: string; exit: string; tollCentavos?: number; rateVersion?: string;
  effectiveFrom?: Date; lastVerifiedAt?: Date | null; source?: string; sourceUrl?: string;
  vehicleClass: VehicleCode; confidence: "HIGH"|"MEDIUM"|"LOW"; estimate?: boolean; warning?: string;
  /** OFFICIALLY_PUBLISHED, INDEPENDENTLY_VERIFIED, THIRD_PARTY_ESTIMATE, UNVERIFIED (see lib/toll-data/statuses.ts). */
  verification?: string;
};
export type TollEstimate = { segments:TollSegment[]; totalCentavos?:number; status:TollCalculationStatus; disclaimer:string; warnings?:string[] };
