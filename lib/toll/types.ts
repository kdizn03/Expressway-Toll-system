export type VehicleCode = "CLASS_1"|"CLASS_2"|"CLASS_3";
export type TollSegment = {
  expressway: string; entry: string; exit: string; tollCentavos?: number; rateVersion?: string;
  effectiveFrom?: Date; lastVerifiedAt?: Date | null; source?: string; sourceUrl?: string;
  confidence: "HIGH"|"MEDIUM"|"LOW"; estimate?: boolean; warning?: string;
};
export type TollEstimate = { segments:TollSegment[]; totalCentavos?:number; status:"VERIFIED"|"VERIFICATION_REQUIRED"|"UNAVAILABLE"|"NOT_APPLICABLE"; disclaimer:string };
