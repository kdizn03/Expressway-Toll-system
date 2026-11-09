import { redirect } from "next/navigation";
import { AccountSettings } from "@/components/account-settings";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export default async function AccountPage() {
  const session = await getCurrentUser(); if (!session) redirect("/login?next=/account");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.id }, select: { fullName: true, email: true, role: true, preferences: true, vehicles: { select: { id: true, name: true, vehicleClass: true, fuelEfficiencyKmPerL: true }, orderBy: { updatedAt: "desc" } }, savedRoutes: { select: { id: true, name: true, origin: true, destination: true }, orderBy: { updatedAt: "desc" } } } });
  return <main className="admin"><a className="brand" href="/">LUZON <span>TOLLMAP</span></a><h1>Account settings</h1><p>Manage the personal information and trip defaults linked to your account.</p><AccountSettings profile={user} vehicles={user.vehicles} savedRoutes={user.savedRoutes}/></main>;
}
