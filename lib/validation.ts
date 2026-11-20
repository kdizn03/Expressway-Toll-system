import { z } from "zod";
export const routeRequestSchema=z.object({origin:z.object({longitude:z.number().gte(-180).lte(180),latitude:z.number().gte(-90).lte(90)}),destination:z.object({longitude:z.number().gte(-180).lte(180),latitude:z.number().gte(-90).lte(90)}),vehicleClass:z.enum(["CLASS_1","CLASS_2","CLASS_3"]),departureAt:z.coerce.date().optional(),roundTrip:z.boolean().default(false)}).refine(x=>x.origin.longitude!==x.destination.longitude||x.origin.latitude!==x.destination.latitude,{message:"Origin and destination must differ"});
/** A place picked from Google Places autocomplete (Place ID plus its location). */
export const selectedPlaceSchema = z.object({
  placeId: z.string().trim().min(1).max(300),
  name: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
});
export const routeSearchSchema = z.object({
  origin: z.string().trim().min(2).max(160),
  destination: z.string().trim().min(2).max(160),
  originPlace: selectedPlaceSchema.optional(),
  destinationPlace: selectedPlaceSchema.optional(),
  vehicleClass: z.enum(["CLASS_1", "CLASS_2", "CLASS_3"]),
  departureAt: z.coerce.date().optional(),
  roundTrip: z.boolean().default(false),
}).refine((input) => input.originPlace && input.destinationPlace
  ? input.originPlace.placeId !== input.destinationPlace.placeId
  : input.origin.toLocaleLowerCase("en-US") !== input.destination.toLocaleLowerCase("en-US"), { message: "Origin and destination must differ." });

const normalizedEmail = z.string().trim().email("Enter a valid email address.").max(254).transform((value) => value.toLocaleLowerCase("en-US"));
const securePassword = z.string().min(12, "Use at least 12 characters.").max(128, "Password is too long.");

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(100),
  email: normalizedEmail,
  password: securePassword,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export const loginSchema = z.object({ email: normalizedEmail, password: z.string().min(1).max(128) });
export const forgotPasswordSchema = z.object({ email: normalizedEmail });
export const resetPasswordSchema = z.object({ token: z.string().min(32).max(512), password: securePassword, confirmPassword: z.string() }).refine((data) => data.password === data.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128).optional(), password: securePassword, confirmPassword: z.string() }).refine((data) => data.password === data.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });
export const profileSchema = z.object({ fullName: z.string().trim().min(2).max(100) });
export const preferenceSchema = z.object({ defaultVehicleClass: z.enum(["CLASS_1", "CLASS_2", "CLASS_3"]).nullable().optional(), fuelEfficiencyKmPerL: z.number().positive().max(100).nullable().optional(), fuelPricePerL: z.number().positive().max(500).nullable().optional(), emailTripUpdates: z.boolean().optional() });
export const vehicleProfileSchema = z.object({ name: z.string().trim().min(1).max(60), vehicleClass: z.enum(["CLASS_1", "CLASS_2", "CLASS_3"]), fuelEfficiencyKmPerL: z.number().positive().max(100).nullable().optional() });
export const savedRouteSchema = z.object({ name: z.string().trim().min(1).max(80), origin: z.string().trim().min(2).max(160), destination: z.string().trim().min(2).max(160), vehicleClass: z.enum(["CLASS_1", "CLASS_2", "CLASS_3"]).nullable().optional(), routeData: z.record(z.string(), z.unknown()).nullable().optional() });
