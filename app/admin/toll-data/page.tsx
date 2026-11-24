import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { isAuthEnabled } from "@/lib/auth/config";
import { TollDataDashboard } from "@/components/admin/toll-data-dashboard";

export const dynamic = "force-dynamic";

export default async function TollDataPage() {
  if (!isAuthEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/toll-data");
  if (!isAdmin(user)) notFound();
  return <main className="admin tollAdmin">
    <a className="brand" href="/">LUZON <span>TOLLMAP</span></a> · <a href="/admin">Rate administration</a>
    <h1>Toll data management</h1>
    <p>Plaza locations, toll rates, automated source monitoring, and data quality. Every change is audit-logged; new rates are used only after approval.</p>
    <TollDataDashboard />
  </main>;
}
