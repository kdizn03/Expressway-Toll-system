import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { isAuthEnabled } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export default async function Trips() {
  if (!isAuthEnabled()) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/trips");
  const trips = await prisma.tripHistory.findMany({ where: { userId: user.id }, orderBy: { traveledAt: "desc" }, take: 50, select: { id: true, origin: true, destination: true, vehicleClass: true, traveledAt: true } });
  return <main className="admin"><a className="brand" href="/">LUZON <span>TOLLMAP</span></a><h1>Your trips</h1><p>Your route calculations are visible only to your signed-in account.</p><section className="table">{trips.length ? <ul className="savedList">{trips.map((trip) => <li key={trip.id}><span><b>{trip.origin} → {trip.destination}</b><br/>{trip.vehicleClass?.replace("_", " ") ?? "Vehicle not recorded"} · {trip.traveledAt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}</span></li>)}</ul> : <p>No route calculations recorded yet. Calculate a route from the planner to begin your personal history.</p>}</section></main>;
}
