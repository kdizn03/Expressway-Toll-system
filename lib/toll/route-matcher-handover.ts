import type { MatchedRoad } from "./calculation-service";

/**
 * Skyway and SLEX hand over at shared interchanges. The provider's step boundary often falls just past the
 * shared plaza, so the next section's nearest plaza is one interchange too far (e.g. Filinvest instead of
 * Alabang). When the previous section ended at a plaza that also exists on the next road, start there.
 */
export function continueAtHandover(matches: MatchedRoad[], shared: Set<string>): MatchedRoad[] {
  return matches.map((match, index) => {
    const previous = matches[index - 1];
    const pair = previous ? `${previous.expressway}>${match.expressway}` : "";
    if ((pair === "SKYWAY>SLEX" || pair === "SLEX>SKYWAY") && shared.has(previous.exit) && match.entry !== previous.exit) return { ...match, entry: previous.exit };
    return match;
  });
}
