export type GoogleMapsErrorCode = "NOT_CONFIGURED" | "PERMISSION_DENIED" | "QUOTA_EXCEEDED" | "INVALID_REQUEST" | "NOT_FOUND" | "UNAVAILABLE" | "NETWORK";

/** A Google Maps Platform failure carrying a message that is safe to show to users. */
export class GoogleMapsError extends Error {
  constructor(readonly code: GoogleMapsErrorCode, readonly userMessage: string, readonly httpStatus: number, detail?: string) {
    super(detail ? `${userMessage} (${detail})` : userMessage);
    this.name = "GoogleMapsError";
  }
}

const serviceLabel = { routes: "Google Routes API", places: "Google Places API (New)" } as const;
export type GoogleService = keyof typeof serviceLabel;

/** Maps a Google API error response (google.rpc.Status) to an actionable, non-sensitive message. */
export function googleErrorFromResponse(service: GoogleService, httpStatus: number, body: unknown): GoogleMapsError {
  const error = (body as { error?: { status?: string; message?: string } } | undefined)?.error;
  const status = error?.status ?? "";
  const detail = `${serviceLabel[service]} ${httpStatus} ${status}`.trim();
  const message = error?.message?.toLowerCase() ?? "";
  if (httpStatus === 429 || status === "RESOURCE_EXHAUSTED") return new GoogleMapsError("QUOTA_EXCEEDED", "Google Maps usage limits were reached. Please try again in a few minutes.", 503, detail);
  if (message.includes("billing")) return new GoogleMapsError("PERMISSION_DENIED", `${serviceLabel[service]} is unavailable because billing is not enabled on the Google Cloud project.`, 503, detail);
  if (httpStatus === 401 || httpStatus === 403 || status === "PERMISSION_DENIED" || status === "UNAUTHENTICATED" || message.includes("api key")) return new GoogleMapsError("PERMISSION_DENIED", `${serviceLabel[service]} rejected the server API key. Check that the key is valid and that the API is enabled for it.`, 503, detail);
  if (httpStatus === 400 || status === "INVALID_ARGUMENT") return new GoogleMapsError("INVALID_REQUEST", "Google Maps could not use those locations. Choose a suggestion from the list and try again.", 422, detail);
  return new GoogleMapsError("UNAVAILABLE", `${serviceLabel[service]} is temporarily unavailable. Please try again shortly.`, 502, detail);
}
