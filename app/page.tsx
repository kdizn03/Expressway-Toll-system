"use client";

import { FormEvent, useState } from "react";
import { TollMap, type RouteGeometry } from "@/components/toll-map";

type TollSegment = { expressway: string; entry: string; exit: string; tollCentavos?: number; estimate?: boolean; warning?: string };
type Toll = { totalCentavos?: number; status: "VERIFIED" | "VERIFICATION_REQUIRED" | "UNAVAILABLE" | "NOT_APPLICABLE"; tollsAvoided?: boolean; segments: TollSegment[] };
type Result = { id: string; mode: "FASTEST" | "BALANCED" | "AVOID_TOLLS"; distanceMeters: number; durationSeconds: number; expressways: string[]; toll: Toll; geometry: RouteGeometry };

const labels: Record<Result["mode"], string> = { FASTEST: "FASTEST", BALANCED: "BALANCED", AVOID_TOLLS: "AVOID TOLLS" };
const formatTime = (seconds: number) => `${Math.floor(seconds / 3600)} hr ${Math.round((seconds % 3600) / 60)} min`;
const databaseOffline = (toll: Toll) => toll.segments.some((segment) => segment.warning?.includes("Rate database is currently unavailable"));
function tollText(toll: Toll) {
  if (toll.status === "NOT_APPLICABLE") return "₱0 · tolls avoided";
  if (databaseOffline(toll)) return "Toll data unavailable";
  if (toll.totalCentavos !== undefined) return `₱${(toll.totalCentavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
  return toll.status === "UNAVAILABLE" ? "Rate unavailable" : "Verification required";
}

export default function Home() {
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedRoute = results[selected];
  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); setResults([]);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/routes/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: form.get("from"), destination: form.get("to"), vehicleClass: form.get("vehicle"), roundTrip: form.get("trip") === "round" }) });
      const body = await response.json();
      if (!response.ok) { setError(body.message ?? "Could not calculate routes."); return; }
      if (!Array.isArray(body.results) || body.results.length === 0) { setError("No driving routes were found for those places."); return; }
      setResults(body.results); setSelected(0);
    } catch { setError("Could not contact the route service. Please try again."); }
    finally { setLoading(false); }
  }
  return <main className="shell">
    <header className="top"><div className="brand">LUZON <span>TOLLMAP</span></div><nav className="nav"><a href="/tollways">Tollways</a><a href="/trips">My trips</a><a href="/admin">Admin</a></nav></header>
    <section className="layout">
      <div className="mapFallback"><i className="road"/><i className="road r2"/><i className="road r3"/></div><TollMap route={selectedRoute?.geometry}/><div className="mapBadge">Mapbox routing · animated selected route</div>
      <form className="panel" onSubmit={calculate}><div className="eyebrow">LUZON EXPRESSWAY PLANNER</div><h1>Plan your trip. Know your toll estimate.</h1>
        <div className="field"><label htmlFor="from">FROM</label><input name="from" id="from" required placeholder="City, landmark, or toll plaza" defaultValue="Baguio City"/></div>
        <div className="field"><label htmlFor="to">TO</label><input name="to" id="to" required placeholder="Destination" defaultValue="Manila"/></div>
        <div className="row"><div className="field"><label htmlFor="vehicle">VEHICLE</label><select name="vehicle" id="vehicle"><option value="CLASS_1">Class 1</option><option value="CLASS_2">Class 2</option><option value="CLASS_3">Class 3</option></select></div><div className="field"><label htmlFor="trip">TRIP TYPE</label><select name="trip" id="trip"><option value="one-way">One way</option><option value="round">Round trip</option></select></div></div>
        <button className="calculate" disabled={loading}>{loading ? "Calculating…" : "Calculate routes"}</button><p className="hint">Verified fees use official sources. Imported third-party matrix matches are clearly marked as estimates.</p>{error && <p role="alert" className="hint">{error}</p>}
      </form>
      {results.length > 0 && <div className="cards" aria-label="Route alternatives">{results.map((route, index) => {
        const unavailable = databaseOffline(route.toll); const estimated = route.toll.segments.some((segment) => segment.estimate);
        return <button type="button" className={`card ${index === selected ? "selected" : ""}`} onClick={() => setSelected(index)} key={route.id}>
          <div className="cardTop"><b>{labels[route.mode]}</b><span>{index === selected ? "SELECTED" : ""}</span></div><h2>{route.expressways.join(" → ") || (route.mode === "AVOID_TOLLS" ? "No toll roads detected" : "Toll-road match unavailable")}</h2><div className="stats"><span>{formatTime(route.durationSeconds)}</span><span>{(route.distanceMeters / 1000).toFixed(1)} km</span></div><div className="toll">{tollText(route.toll)}</div>
          {estimated && <small className="estimateNote">Third-party matrix estimate · verify before travel</small>}
          {unavailable ? <small className="cardNote">Start PostgreSQL to load verified plaza and toll-rate data.</small> : route.toll.segments.map((segment) => <small className="segment" key={`${segment.expressway}-${segment.entry}`}>{segment.expressway}: {segment.tollCentavos === undefined ? `${segment.entry} → ${segment.exit}: rate unavailable` : `₱${(segment.tollCentavos / 100).toFixed(2)}${segment.estimate ? " estimate" : ""}`}</small>)}
        </button>;
      })}</div>}
      <aside className="notice"><b>Rate trust matters.</b><br/>A total appears when every identified toll segment has a match. Third-party matrix totals remain estimates until a primary source verifies them.</aside>
    </section>
  </main>;
}
