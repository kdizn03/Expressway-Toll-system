export type VehicleCode = "CLASS_1"|"CLASS_2"|"CLASS_3";
export type TollCalculationStatus = "VERIFIED"|"ESTIMATED"|"INCOMPLETE"|"UNAVAILABLE";
export type TollSegment = {
  expressway: string; exitExpressway?: string; entry: string; exit: string; tollCentavos?: number; rateVersion?: string;
  effectiveFrom?: Date; lastVerifiedAt?: Date | null; source?: string; sourceUrl?: string;
  vehicleClass: VehicleCode; confidence: "HIGH"|"MEDIUM"|"LOW"; estimate?: boolean; warning?: string;
};
export type TollEstimate = { segments:TollSegment[]; totalCentavos?:number; status:TollCalculationStatus; disclaimer:string; warnings?:string[] };
