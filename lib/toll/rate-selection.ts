export type EffectiveRate<T> = T & {
  status: "DRAFT" | "PENDING_REVIEW" | "SCHEDULED" | "PUBLISHED" | "EXPIRED" | "REJECTED";
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

/** Selects the newest published rate whose effective window contains travelDate. */
export function selectEffectiveRate<T>(rates: EffectiveRate<T>[], travelDate = new Date()): EffectiveRate<T> | undefined {
  return rates
    .filter((rate) => rate.status === "PUBLISHED" && rate.effectiveFrom <= travelDate && (!rate.effectiveTo || rate.effectiveTo > travelDate))
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
}
