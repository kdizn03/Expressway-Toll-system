export type VehicleCode = "CLASS_1"|"CLASS_2"|"CLASS_3";
export type TollSegment = { expressway: string; entry: string; exit: string; tollCentavos?: number; rateVersion?: string; confidence: "HIGH"|"MEDIUM"|"LOW"; warning?: string };
export type TollEstimate = { segments:TollSegment[]; totalCentavos?:number; status:"VERIFIED"|"VERIFICATION_REQUIRED"|"MISSING_DATA"; disclaimer:string };
