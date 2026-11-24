/**
 * Verification vocabulary for toll data. Approval status (RateStatus: DRAFT … PUBLISHED) says whether
 * a record is in use; verification status says how trustworthy its content is.
 */
export const RATE_VERIFICATION = {
  OFFICIALLY_PUBLISHED: "Officially published (TRB or operator document)",
  INDEPENDENTLY_VERIFIED: "Independently verified (matches a TRB-approved rate reported by news outlets)",
  THIRD_PARTY_ESTIMATE: "Third-party estimate",
  UNDER_REVIEW: "Under review",
  UNVERIFIED: "Unverified",
  SUPERSEDED: "Superseded by a newer approved rate",
  REJECTED: "Rejected",
} as const;
export type RateVerification = keyof typeof RATE_VERIFICATION;

export const PLAZA_VERIFICATION = {
  VERIFIED_GEODATA: "Location verified: named toll booth in OpenStreetMap on the expressway's own road",
  NEEDS_REVIEW: "Candidate location found, identity needs review",
  SUSPECT: "Stored location is implausible (off Luzon, stacked with other plazas, or far from the expressway)",
  UNVERIFIED: "Not yet verified",
} as const;
export type PlazaVerification = keyof typeof PLAZA_VERIFICATION;

/** Verification statuses that may never be priced, whatever the import's approval status. */
export const UNUSABLE_ROW_STATUSES: RateVerification[] = ["SUPERSEDED", "REJECTED"];

export function rateVerificationLabel(status: string | null | undefined) {
  return status && status in RATE_VERIFICATION ? RATE_VERIFICATION[status as RateVerification] : RATE_VERIFICATION.THIRD_PARTY_ESTIMATE;
}
