import { prisma } from "@/lib/db";
import { isCustomerFacingSource } from "@/lib/toll/source-policy";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SourceRow = { id: string; name: string; officialUrl: string; sourceType: string; enabled: boolean; lastCheckedAt: Date | null };
type ImportRow = { id: string; rowCount: number; status: "DRAFT" | "PENDING_REVIEW" | "SCHEDULED" | "PUBLISHED" | "EXPIRED" | "REJECTED"; retrievedAt: Date; source: { name: string } };

async function loadAdminData(): Promise<{ sources: SourceRow[]; imports: ImportRow[] } | null> {
  try {
    const [sources, imports] = await Promise.all([
      prisma.rateSource.findMany({
        select: { id: true, name: true, officialUrl: true, sourceType: true, enabled: true, lastCheckedAt: true },
        orderBy: { name: "asc" },
      }),
      prisma.matrixImport.findMany({
        select: { id: true, rowCount: true, status: true, retrievedAt: true, source: { select: { name: true } } },
        orderBy: { retrievedAt: "desc" },
        take: 10,
      }),
    ]);
    return { sources, imports };
  } catch {
    return null;
  }
}

export default async function Admin() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (!isAdmin(user)) notFound();
  const data = await loadAdminData();
  const sources = data?.sources ?? null;
  const imports = data?.imports ?? null;
  const primaryCount = sources?.filter((source) => isCustomerFacingSource(source.sourceType)).length ?? 0;
  const secondaryCount = sources?.filter((source) => source.sourceType === "secondary_matrix_reference").length ?? 0;
  const stagedRowCount = imports?.reduce((total, item) => total + item.rowCount, 0) ?? 0;

  return <main className="admin">
    <a className="brand" href="/">LUZON <span>TOLLMAP</span></a>
    <h1>Rate administration</h1>
    <p>Published historical rates are immutable. All changes require a source and an audit trail.</p>
    <section className="grid">
      <div className="metric"><strong>{primaryCount}</strong>Primary rate sources</div>
      <div className="metric"><strong>{secondaryCount}</strong>Secondary matrix references</div>
      <div className="metric"><strong>{stagedRowCount}</strong>Staged matrix rows</div>
    </section>
    <section className="table">
      <h2>Rate-source registry</h2>
      {sources === null ? <p>Start PostgreSQL to load the source registry.</p> : <table>
        <thead><tr><th>Source</th><th>Last reference date</th><th>Use</th><th>Status</th></tr></thead>
        <tbody>{sources.map((source) => {
          const primary = isCustomerFacingSource(source.sourceType);
          return <tr key={source.id}>
            <td><a href={source.officialUrl} target="_blank" rel="noreferrer">{source.name}</a></td>
            <td>{source.lastCheckedAt?.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) ?? "Not recorded"}</td>
            <td>{primary ? "Primary verification" : "Cross-check only"}</td>
            <td><span className="pill">{primary && source.enabled ? "Eligible after review" : "Manual verification required"}</span></td>
          </tr>;
        })}</tbody>
      </table>}
    </section>
    <section className="table">
      <h2>Staged matrix imports</h2>
      {imports === null ? <p>Start PostgreSQL to load staged imports.</p> : imports.length === 0 ? <p>No secondary matrix import has been staged yet.</p> : <table>
        <thead><tr><th>Source</th><th>Retrieved</th><th>Rows</th><th>Status</th></tr></thead>
        <tbody>{imports.map((item) => <tr key={item.id}>
          <td>{item.source.name}</td>
          <td>{item.retrievedAt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}</td>
          <td>{item.rowCount.toLocaleString()}</td>
          <td><span className="pill">{item.status === "PENDING_REVIEW" ? "Manual verification required" : item.status}</span></td>
        </tr>)}</tbody>
      </table>}
    </section>
  </main>;
}
