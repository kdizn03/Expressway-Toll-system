"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { importGoogleLibrary, mapId } from "@/components/google-maps-loader";
import { RATE_VERIFICATION, PLAZA_VERIFICATION } from "@/lib/toll-data/statuses";

type Tab = "quality" | "plazas" | "rates" | "monitor" | "settings";
type Plaza = { id: string; name: string; latitude: number; longitude: number; aliases: string[] | null; plazaType: string | null; kmPost: number | null; sequence: number | null; verificationStatus: string; verificationSource: string | null; verifiedAt: string | null; active: boolean; notes: string | null; expressway: { abbreviation: string }; _count: { entryRates: number; exitRates: number } };
type ImportItem = { id: string; status: string; verificationStatus: string; retrievedAt: string; reportedUpdatedAt: string | null; effectiveFrom: string | null; rowCount: number; reviewedBy: string | null; reviewNote: string | null; notes: string | null; sourceUrl: string; source: { id: string; name: string; sourceType: string }; changeReport: { summary: Record<string, unknown> } | null };
type Change = { entry: string; exit: string; vehicleClass: string; fromCentavos?: number; toCentavos?: number };

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/admin/toll-data/${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status}).`);
  return body as T;
};
const peso = (centavos?: number) => centavos === undefined ? "—" : `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—";
const statusColor: Record<string, string> = { VERIFIED_GEODATA: "#1b825b", NEEDS_REVIEW: "#c88a00", SUSPECT: "#b94a30", UNVERIFIED: "#7a8a80" };

export function TollDataDashboard() {
  const [tab, setTab] = useState<Tab>("quality");
  const [message, setMessage] = useState("");
  return <div className="tollDashboard">
    <nav className="tollTabs" role="tablist">{(["quality", "plazas", "rates", "monitor", "settings"] as Tab[]).map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{{ quality: "Data quality", plazas: "Toll plazas", rates: "Rates & approvals", monitor: "Automated updates", settings: "Settings" }[item]}</button>)}</nav>
    {message && <p className="formSuccess" role="status">{message}</p>}
    {tab === "quality" && <QualityTab />}
    {tab === "plazas" && <PlazasTab notify={setMessage} />}
    {tab === "rates" && <RatesTab notify={setMessage} />}
    {tab === "monitor" && <MonitorTab notify={setMessage} />}
    {tab === "settings" && <SettingsTab notify={setMessage} />}
  </div>;
}

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState("");
  const reload = useCallback(() => { setError(""); api<T>(path).then(setData).catch((reason: Error) => setError(reason.message)); }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function QualityTab() {
  const { data, error } = useLoad<{ counts: Record<string, number>; rateVerification: Record<string, number>; missingCoordinates: Array<{ expressway: string; plaza: string }>; suspectCoordinates: Array<{ expressway: string; plaza: string; status: string; reason: string }>; duplicates: Array<{ expressway: string; plazas: string[]; reason: string }>; plazasWithoutRates: Array<{ expressway: string; plaza: string }>; incompleteMatrices: Array<{ source: string; incompletePairs: number }>; outdated: Array<{ source: string; dataDate: string }>; unmatchedSegments: Array<{ expressway: string; reason: string }>; failingSources: Array<{ source: string; failures: number; lastError: string }> }>("quality");
  if (error) return <p className="formError">{error}</p>;
  if (!data) return <p>Loading data quality…</p>;
  const labels: Record<string, string> = { missingCoordinates: "Rated plazas without a location", suspectCoordinates: "Suspect or unreviewed locations", duplicatePlazas: "Possible duplicate plazas", plazasWithoutRates: "Plazas without rates", incompleteMatrices: "Incomplete matrices", outdatedImports: "Outdated rate data (>120 days)", unmatchedSegments: "Unmatched expressways", pendingImports: "Imports awaiting approval", failingSources: "Failing sources" };
  const list = (title: string, items: string[]) => items.length > 0 && <section className="table"><h2>{title} ({items.length})</h2><ul className="qualityList">{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
  return <>
    <section className="grid tollMetrics">{Object.entries(data.counts).map(([key, value]) => <div className={`metric ${value > 0 ? "attention" : ""}`} key={key}><strong>{value}</strong>{labels[key] ?? key}</div>)}</section>
    <section className="table"><h2>Rate verification (approved rows)</h2><ul className="qualityList">{Object.entries(data.rateVerification).map(([key, value]) => <li key={key}><b>{value.toLocaleString()}</b> {key === "IMPORT_DEFAULT" ? "labelled by their import (third-party estimate or official)" : RATE_VERIFICATION[key as keyof typeof RATE_VERIFICATION] ?? key}</li>)}</ul></section>
    {list("Expressways that cannot be priced", data.unmatchedSegments.map((item) => `${item.expressway}: ${item.reason}`))}
    {list("Rated plazas without a location", data.missingCoordinates.map((item) => `${item.expressway} · ${item.plaza}`))}
    {list("Suspect or unreviewed locations", data.suspectCoordinates.map((item) => `${item.expressway} · ${item.plaza} — ${item.status}: ${item.reason}`))}
    {list("Possible duplicate plazas", data.duplicates.map((item) => `${item.expressway} · ${item.plazas.join(" / ")} (${item.reason})`))}
    {list("Plazas without rates", data.plazasWithoutRates.map((item) => `${item.expressway} · ${item.plaza}`))}
    {list("Incomplete matrices", data.incompleteMatrices.map((item) => `${item.source}: ${item.incompletePairs} pair(s) missing a vehicle class`))}
    {list("Outdated rate data", data.outdated.map((item) => `${item.source} (data from ${item.dataDate})`))}
    {list("Failing sources", data.failingSources.map((item) => `${item.source}: ${item.failures} failure(s) — ${item.lastError}`))}
  </>;
}

function PlazaMap({ plazas, selected, onSelect }: { plazas: Plaza[]; selected?: string; onSelect: (id: string) => void }) {
  const target = useRef<HTMLDivElement>(null); const map = useRef<google.maps.Map | null>(null); const markers = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([importGoogleLibrary("maps"), importGoogleLibrary("marker"), importGoogleLibrary("core")]).then(([maps, marker, core]) => {
      if (!active || !target.current) return;
      map.current ??= new maps.Map(target.current, { center: { lat: 15.0, lng: 120.9 }, zoom: 8, mapId: mapId(), streetViewControl: false, mapTypeControl: false, fullscreenControl: true });
      markers.current.forEach((item) => { item.map = null; });
      const bounds = new core.LatLngBounds();
      markers.current = plazas.map((plaza) => {
        const pin = new marker.PinElement({ background: plaza.active ? statusColor[plaza.verificationStatus] ?? "#7a8a80" : "#c8cfca", borderColor: plaza.id === selected ? "#111" : "#fff", glyphText: "", scale: plaza.id === selected ? 1.2 : 0.75 });
        const item = new marker.AdvancedMarkerElement({ map: map.current, position: { lat: plaza.latitude, lng: plaza.longitude }, content: pin, title: `${plaza.expressway.abbreviation} · ${plaza.name} (${plaza.verificationStatus}${plaza.active ? "" : ", inactive"})` });
        item.addListener("click", () => onSelect(plaza.id));
        if (plaza.active) bounds.extend({ lat: plaza.latitude, lng: plaza.longitude });
        return item;
      });
      if (!bounds.isEmpty() && !selected) map.current.fitBounds(bounds, 40);
    }).catch((reason: Error) => setError(reason.message));
    return () => { active = false; };
  }, [plazas, selected, onSelect]);
  return <div className="plazaMapWrap">{error ? <p className="formError">{error}</p> : <div ref={target} className="plazaMap" aria-label="Map of toll plazas coloured by verification status" />}</div>;
}

function PlazasTab({ notify }: { notify: (message: string) => void }) {
  const [expressway, setExpressway] = useState("");
  const { data, error, reload } = useLoad<Plaza[]>(`plazas${expressway ? `?expressway=${expressway}` : ""}`);
  const [selectedId, setSelectedId] = useState<string>();
  const [filter, setFilter] = useState("all");
  const plazas = (data ?? []).filter((plaza) => filter === "all" || (filter === "inactive" ? !plaza.active : plaza.verificationStatus === filter));
  const selected = data?.find((plaza) => plaza.id === selectedId);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);
  return <>
    <div className="tollFilters">
      <label>Expressway <select value={expressway} onChange={(event) => setExpressway(event.target.value)}><option value="">All</option>{["NLEX", "SCTEX", "TPLEX", "NLEX_CONNECTOR", "SKYWAY", "SLEX", "STAR", "CALAX", "CAVITEX", "NAIAX", "MCX", "C5_LINK"].map((code) => <option key={code}>{code}</option>)}</select></label>
      <label>Status <select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All</option>{Object.keys(PLAZA_VERIFICATION).map((key) => <option key={key} value={key}>{key}</option>)}<option value="inactive">Inactive</option></select></label>
      <span className="legend">{Object.entries(statusColor).map(([key, color]) => <i key={key}><b style={{ background: color }} />{key}</i>)}</span>
    </div>
    {error && <p className="formError">{error}</p>}
    <PlazaMap plazas={plazas} selected={selectedId} onSelect={onSelect} />
    {selected && <PlazaEditor plaza={selected} onSaved={() => { notify(`Saved ${selected.name}.`); reload(); }} />}
    <section className="table"><h2>Plazas ({plazas.length})</h2><table><thead><tr><th>Expressway</th><th>#</th><th>Plaza</th><th>Location</th><th>Status</th><th>Rates</th></tr></thead>
      <tbody>{plazas.map((plaza) => <tr key={plaza.id} className={plaza.id === selectedId ? "selectedRow" : ""} onClick={() => setSelectedId(plaza.id)}>
        <td>{plaza.expressway.abbreviation}</td><td>{plaza.sequence ?? ""}</td>
        <td>{plaza.name}{plaza.aliases?.length ? <small> ({plaza.aliases.join(", ")})</small> : null}{!plaza.active && <span className="pill">inactive</span>}</td>
        <td>{plaza.latitude.toFixed(4)}, {plaza.longitude.toFixed(4)}</td>
        <td><span className="pill" style={{ background: `${statusColor[plaza.verificationStatus]}22`, color: statusColor[plaza.verificationStatus] }}>{plaza.verificationStatus}</span>{plaza.notes && <small className="block">{plaza.notes}</small>}</td>
        <td>{plaza._count.entryRates + plaza._count.exitRates || ""}</td>
      </tr>)}</tbody></table></section>
  </>;
}

function PlazaEditor({ plaza, onSaved }: { plaza: Plaza; onSaved: () => void }) {
  const [form, setForm] = useState({ name: plaza.name, latitude: String(plaza.latitude), longitude: String(plaza.longitude), aliases: (plaza.aliases ?? []).join("; "), plazaType: plaza.plazaType ?? "", kmPost: plaza.kmPost?.toString() ?? "", verificationStatus: plaza.verificationStatus, verificationSource: plaza.verificationSource ?? "", active: plaza.active, notes: plaza.notes ?? "", reason: "" });
  const [error, setError] = useState("");
  useEffect(() => { setForm({ name: plaza.name, latitude: String(plaza.latitude), longitude: String(plaza.longitude), aliases: (plaza.aliases ?? []).join("; "), plazaType: plaza.plazaType ?? "", kmPost: plaza.kmPost?.toString() ?? "", verificationStatus: plaza.verificationStatus, verificationSource: plaza.verificationSource ?? "", active: plaza.active, notes: plaza.notes ?? "", reason: "" }); setError(""); }, [plaza]);
  const field = (key: keyof typeof form, label: string, wide = false) => <label className={wide ? "wide" : ""}>{label}<input value={String(form[key])} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>;
  async function save() {
    setError("");
    const moved = Number(form.latitude) !== plaza.latitude || Number(form.longitude) !== plaza.longitude;
    try {
      await api(`plazas/${plaza.id}`, { method: "PATCH", body: JSON.stringify({
        name: form.name, ...(moved ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : {}),
        aliases: form.aliases.split(";").map((value) => value.trim()).filter(Boolean), plazaType: form.plazaType || null, kmPost: form.kmPost ? Number(form.kmPost) : null,
        verificationStatus: form.verificationStatus, verificationSource: form.verificationSource || null, active: form.active, notes: form.notes || null, reason: form.reason,
      }) });
      onSaved();
    } catch (reason) { setError((reason as Error).message); }
  }
  return <section className="table plazaEditor"><h2>Edit {plaza.expressway.abbreviation} · {plaza.name}</h2>
    {plaza.verificationSource && <p className="sourceNote">Verified from: {plaza.verificationSource} ({date(plaza.verifiedAt)})</p>}
    <div className="editorGrid">
      {field("name", "Name")}{field("latitude", "Latitude")}{field("longitude", "Longitude")}{field("kmPost", "Km post")}
      <label>Type<select value={form.plazaType} onChange={(event) => setForm({ ...form, plazaType: event.target.value })}><option value="">Not determined</option><option>ENTRY_EXIT</option><option>ENTRY</option><option>EXIT</option><option>BARRIER</option></select></label>
      <label>Verification<select value={form.verificationStatus} onChange={(event) => setForm({ ...form, verificationStatus: event.target.value })}>{Object.keys(PLAZA_VERIFICATION).map((key) => <option key={key}>{key}</option>)}</select></label>
      <label className="checkbox"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Active</label>
      {field("aliases", "Aliases (separate with ;)", true)}{field("verificationSource", "Verification source", true)}{field("notes", "Notes", true)}{field("reason", "Reason for this change (required)", true)}
    </div>
    {error && <p className="formError">{error}</p>}
    <button className="share" onClick={save} disabled={form.reason.trim().length < 3}>Save changes</button>
  </section>;
}

function ImportDetail({ item, onDone, notify }: { item: ImportItem; onDone: () => void; notify: (message: string) => void }) {
  const { data } = useLoad<{ changeReport: { details: { changed: Change[]; added: Change[]; removed: Change[]; plazasAdded: string[]; plazasRemoved: string[] } } | null }>(`imports/${item.id}`);
  const [note, setNote] = useState(""); const [error, setError] = useState("");
  const act = async (action: "approve" | "reject" | "rollback") => {
    setError("");
    try { await api(`imports/${item.id}/${action}`, { method: "POST", body: JSON.stringify(action === "approve" ? { note } : { reason: note }) }); notify(`Import ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "rolled back"}.`); onDone(); }
    catch (reason) { setError((reason as Error).message); }
  };
  const details = data?.changeReport?.details;
  const rows = (title: string, changes: Change[] | undefined) => changes && changes.length > 0 && <><h3>{title} ({changes.length})</h3><table><thead><tr><th>Entry</th><th>Exit</th><th>Class</th><th>Current</th><th>Proposed</th></tr></thead><tbody>{changes.slice(0, 200).map((change, index) => <tr key={index}><td>{change.entry}</td><td>{change.exit}</td><td>{change.vehicleClass.replace("CLASS_", "")}</td><td>{peso(change.fromCentavos)}</td><td>{peso(change.toCentavos)}</td></tr>)}</tbody></table></>;
  return <section className="table importDetail">
    <h2>{item.source.name}</h2>
    <p>{item.rowCount.toLocaleString()} rows · retrieved {date(item.retrievedAt)} · effective {item.effectiveFrom ? date(item.effectiveFrom) : "not stated"} · {RATE_VERIFICATION[item.verificationStatus as keyof typeof RATE_VERIFICATION] ?? item.verificationStatus}</p>
    {item.notes && <p className="sourceNote">{item.notes}</p>}
    <p><a href={`/api/admin/toll-data/imports/${item.id}/source`} target="_blank" rel="noreferrer">Inspect the original source document</a> · <a href={item.sourceUrl.startsWith("http") ? item.sourceUrl : "#"} target="_blank" rel="noreferrer">{item.sourceUrl}</a></p>
    {details ? <>{rows("Changed fares", details.changed)}{rows("Added fares", details.added)}{rows("Removed fares", details.removed)}{details.plazasAdded.length > 0 && <p>Plazas added: {details.plazasAdded.join(", ")}</p>}{details.plazasRemoved.length > 0 && <p>Plazas removed: {details.plazasRemoved.join(", ")}</p>}</> : <p>Loading the difference report…</p>}
    {(item.status === "PENDING_REVIEW" || item.status === "PUBLISHED") && <div className="reviewActions">
      <input placeholder={item.status === "PENDING_REVIEW" ? "Review note or rejection reason" : "Reason for rollback"} value={note} onChange={(event) => setNote(event.target.value)} />
      {item.status === "PENDING_REVIEW" && <><button className="share" onClick={() => act("approve")}>Approve</button><button className="dangerButton" onClick={() => act("reject")} disabled={note.trim().length < 3}>Reject</button></>}
      {item.status === "PUBLISHED" && <button className="dangerButton" onClick={() => act("rollback")} disabled={note.trim().length < 3}>Roll back</button>}
    </div>}
    {error && <p className="formError">{error}</p>}
  </section>;
}

function RatesTab({ notify }: { notify: (message: string) => void }) {
  const [status, setStatus] = useState("PENDING_REVIEW");
  const imports = useLoad<ImportItem[]>(`imports${status ? `?status=${status}` : ""}`);
  const [openId, setOpenId] = useState<string>();
  const [expressway, setExpressway] = useState("SLEX"); const [vehicleClass, setVehicleClass] = useState("CLASS_1");
  const rates = useLoad<{ rows: Array<{ id: string; entryExpresswayCode: string; exitExpresswayCode: string; entryName: string; exitName: string; vehicleClassCode: string; tollCentavos: number; verificationStatus: string | null; verificationNote: string | null; matrixImport: { verificationStatus: string; retrievedAt: string; source: { name: string } } }>; versions: Array<{ id: string; versionNumber: number; status: string; effectiveFrom: string; effectiveTo: string | null; verificationStatus: string | null; sourceReference: string | null; expressway: { abbreviation: string }; _count: { rates: number } }> }>(`rates?expressway=${expressway}&vehicleClass=${vehicleClass}&limit=400`);
  const open = imports.data?.find((item) => item.id === openId);
  return <>
    <section className="table"><h2>Rate imports</h2>
      <div className="tollFilters"><label>Status <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="PENDING_REVIEW">Awaiting approval</option><option value="PUBLISHED">Approved (in use)</option><option value="EXPIRED">Superseded</option><option value="REJECTED">Rejected</option><option value="">All</option></select></label></div>
      {imports.error && <p className="formError">{imports.error}</p>}
      <table><thead><tr><th>Source</th><th>Retrieved</th><th>Rows</th><th>Changes</th><th>Status</th></tr></thead><tbody>{(imports.data ?? []).map((item) => {
        const summary = item.changeReport?.summary as { changed?: number; added?: number; removed?: number } | undefined;
        return <tr key={item.id} className={item.id === openId ? "selectedRow" : ""} onClick={() => setOpenId(item.id)}><td>{item.source.name}</td><td>{date(item.retrievedAt)}</td><td>{item.rowCount.toLocaleString()}</td><td>{summary ? `${summary.changed ?? 0} changed · ${summary.added ?? 0} added · ${summary.removed ?? 0} removed` : "—"}</td><td><span className="pill">{item.status}</span></td></tr>;
      })}</tbody></table>
    </section>
    {open && <ImportDetail item={open} notify={notify} onDone={() => { setOpenId(undefined); imports.reload(); rates.reload(); }} />}
    <section className="table"><h2>Rates in use</h2>
      <div className="tollFilters">
        <label>Expressway <select value={expressway} onChange={(event) => setExpressway(event.target.value)}>{["NLEX", "SCTEX", "TPLEX", "NLEX CONN", "SKYWAY", "SKYWAY3", "SLEX", "STAR", "CALAX", "CAVITEX", "NAIAX"].map((code) => <option key={code}>{code}</option>)}</select></label>
        <label>Vehicle class <select value={vehicleClass} onChange={(event) => setVehicleClass(event.target.value)}><option value="CLASS_1">Class 1</option><option value="CLASS_2">Class 2</option><option value="CLASS_3">Class 3</option></select></label>
      </div>
      {rates.data && rates.data.versions.length > 0 && <p>Official rate versions: {rates.data.versions.map((version) => `${version.expressway.abbreviation} v${version.versionNumber} ${version.status} from ${version.effectiveFrom.slice(0, 10)}${version.effectiveTo ? ` to ${version.effectiveTo.slice(0, 10)}` : ""} (${version._count.rates} rates)`).join(" · ")}</p>}
      <table><thead><tr><th>Entry</th><th>Exit</th><th>Fare</th><th>Verification</th><th>Source</th></tr></thead><tbody>{(rates.data?.rows ?? []).map((row) => {
        const verification = row.verificationStatus ?? row.matrixImport.verificationStatus;
        return <tr key={row.id}><td>{row.entryName}</td><td>{row.exitName}{row.entryExpresswayCode !== row.exitExpresswayCode && <small> ({row.exitExpresswayCode})</small>}</td><td>{peso(row.tollCentavos)}</td><td><span className="pill" title={row.verificationNote ?? ""}>{RATE_VERIFICATION[verification as keyof typeof RATE_VERIFICATION] ?? verification}</span></td><td>{row.matrixImport.source.name}</td></tr>;
      })}</tbody></table>
    </section>
  </>;
}

function MonitorTab({ notify }: { notify: (message: string) => void }) {
  const { data, error, reload } = useLoad<{ sources: Array<{ id: string; name: string; officialUrl: string; sourceType: string; monitorEnabled: boolean; parser: string | null; checkIntervalHours: number; lastCheckedAt: string | null; lastSuccessfulAt: string | null; nextCheckAt: string | null; consecutiveFailures: number; lastError: string | null; notes: string | null }>; checks: Array<{ id: string; startedAt: string; outcome: string; message: string | null; trigger: string; source: { name: string } }>; alerts: Array<{ id: string; createdAt: string; action: string; reason: string | null }> }>("monitor");
  const [running, setRunning] = useState(false);
  const run = async () => { setRunning(true); try { const result = await api<{ checked?: number; skipped?: boolean; reason?: string }>("monitor/run", { method: "POST" }); notify(result.skipped ? result.reason ?? "Skipped." : `Checked ${result.checked} source(s).`); reload(); } catch (reason) { notify((reason as Error).message); } finally { setRunning(false); } };
  if (error) return <p className="formError">{error}</p>;
  if (!data) return <p>Loading monitoring status…</p>;
  const monitored = data.sources.filter((source) => source.monitorEnabled);
  const lastSuccess = monitored.map((source) => source.lastSuccessfulAt).filter(Boolean).sort().at(-1);
  const nextCheck = monitored.map((source) => source.nextCheckAt).filter(Boolean).sort()[0];
  return <>
    <section className="grid tollMetrics">
      <div className="metric"><strong>{monitored.length}</strong>Sources monitored</div>
      <div className="metric"><strong>{date(lastSuccess)}</strong>Last successful check</div>
      <div className="metric"><strong>{date(nextCheck)}</strong>Next scheduled check</div>
      <div className="metric"><strong>{data.checks.filter((check) => check.outcome === "CHANGED").length}</strong>Changes detected (recent)</div>
      <div className="metric"><strong>{data.checks.filter((check) => check.outcome === "FAILED").length}</strong>Failed checks (recent)</div>
    </section>
    <button className="share" onClick={run} disabled={running}>{running ? "Checking sources…" : "Check all sources now"}</button>
    <section className="table"><h2>Sources</h2><table><thead><tr><th>Source</th><th>Mode</th><th>Last checked</th><th>Next check</th><th>Status</th></tr></thead><tbody>{data.sources.map((source) => <tr key={source.id}>
      <td><a href={source.officialUrl.startsWith("http") ? source.officialUrl : "#"} target="_blank" rel="noreferrer">{source.name}</a><small className="block">{source.sourceType}</small></td>
      <td>{source.monitorEnabled ? `Automatic · ${source.parser} · every ${source.checkIntervalHours} h` : <span title={source.notes ?? ""}>Manual import only</span>}{!source.monitorEnabled && source.notes && <small className="block">{source.notes}</small>}</td>
      <td>{date(source.lastCheckedAt)}</td><td>{source.monitorEnabled ? date(source.nextCheckAt) : "—"}</td>
      <td>{source.consecutiveFailures > 0 ? <span className="pill" title={source.lastError ?? ""}>Failing ({source.consecutiveFailures})</span> : source.monitorEnabled ? "OK" : ""}</td>
    </tr>)}</tbody></table></section>
    <section className="table"><h2>Recent checks</h2><table><thead><tr><th>When</th><th>Source</th><th>Trigger</th><th>Outcome</th><th>Details</th></tr></thead><tbody>{data.checks.map((check) => <tr key={check.id}><td>{date(check.startedAt)}</td><td>{check.source.name}</td><td>{check.trigger}</td><td><span className="pill">{check.outcome}</span></td><td>{check.message}</td></tr>)}</tbody></table></section>
    <section className="table"><h2>Alerts and approvals</h2><ul className="qualityList">{data.alerts.map((alert) => <li key={alert.id}>{date(alert.createdAt)} · <b>{alert.action}</b> · {alert.reason}</li>)}</ul></section>
  </>;
}

function SettingsTab({ notify }: { notify: (message: string) => void }) {
  const { data, reload } = useLoad<{ settings: { autoPublishOfficial: boolean; defaultCheckIntervalHours: number } }>("monitor");
  const toggle = async (value: boolean) => { try { await api("settings", { method: "PATCH", body: JSON.stringify({ autoPublishOfficial: value }) }); notify(`Automatic publication ${value ? "enabled" : "disabled"}.`); reload(); } catch (reason) { notify((reason as Error).message); } };
  if (!data) return <p>Loading settings…</p>;
  return <section className="table"><h2>Publication policy</h2>
    <label className="checkbox"><input type="checkbox" checked={data.settings.autoPublishOfficial} onChange={(event) => toggle(event.target.checked)} />Allow automatic publication of complete, validated matrices from authoritative sources that also opt in</label>
    <p>Off by default. Third-party estimates, incomplete matrices, rates without an effective date, ambiguous plaza names, and invalid vehicle classes are never published automatically, whatever this setting.</p>
  </section>;
}
