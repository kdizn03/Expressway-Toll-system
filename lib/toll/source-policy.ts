/**
 * Sources that may supply a customer-facing toll amount. A source can be
 * useful for comparison without being authoritative enough to publish from.
 */
export const CUSTOMER_FACING_SOURCE_TYPES = [
  "official_regulator",
  "official_operator_disclosure",
] as const;

export const SECONDARY_MATRIX_SOURCE_TYPE = "secondary_matrix_reference";

export function isCustomerFacingSource(sourceType: string) {
  return (CUSTOMER_FACING_SOURCE_TYPES as readonly string[]).includes(sourceType);
}
