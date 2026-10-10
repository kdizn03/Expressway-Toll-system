import { TollCalculationService } from "./calculation-service";
import { databaseRateLookup } from "./rate-repository";

/** The application-wide calculation service always resolves fees through the central database repository. */
export const tollCalculationService = new TollCalculationService(databaseRateLookup);
