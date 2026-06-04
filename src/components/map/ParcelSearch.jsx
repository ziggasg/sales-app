import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Search, MapPin, FileText, MousePointer, ChevronDown, ChevronUp, X, Loader2 } from "lucide-react";
import {
  DIST, SRC, BASE_QUERY, BASE_IDENTIFY, QRTR_URL,
  fetchAllVillages, ringToLatLng, getLatLngCentroid,
  KNOWN_KEYS, fmtLabel, fmtValue,
} from "./MapHelpers";

const inputCls = "w-full px-3 py-2 bg-[#f5f0ff] border border-[#e0d8f0] rounded-xl text-[#1a1625] text-xs focus:outline-none focus:ring-2 focus:ring-[#6750a4] placeholder:text-[#9c8fba]";
const selectCls = "w-full px-3 py-2 bg-[#f5f0ff] border border-[#e0d8f0] rounded-xl text-[#1a1625] text-xs focus:outline-none focus:ring-2 focus:ring-[#6750a4]";

export default function ParcelSearch({ mapRef }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("codes");
  const [dist, setDist] = useState("");
  const [vil, setVil] = useState("");
  const [qrtr, setQrtr] = useState("");
  const [blck, setBlck] = useState("");
  const [parcel, setParcel] = useState("");
  const [sheet, setSheet] = useState("");
  const [plan, setPlan] = useState("");
  const [regDist, setRegDist] = useState("");
  const [regVil, setRegVil] = useState("");
  const [regNo, setRegNo] = useState("");

  const [villages, setVillages] = useState([]);
  const [quarters, setQuarters] = useState([]);
  const [vilStatus, setVilStatus] = useState("");

  const [status, setStatus] = useState({ msg: "Select a district, then search.", loading: false, error: false });
  const [results, setResults] = useState([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [detailFor, setDetailFor] = useState(null);

  const layerRef = useRef(null);
  const selectedRef = useRef(null);

  useEffect(() => {
    const tryAttach = () => {
      const map = mapRef.current;
      if (!map) return false;
      if (!layerRef.current) layerRef.current = L.layerGroup().addTo(map);
      return true;
    };
    if (!tryAttach()) {
      const id = setInterval(() => { if (tryAttach()) clearInterval(id); }, 200);
      return () => clearInterval(id);
    }
  }, [mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = async (e) => {
      if (mode !== "map") return;
      setStatus({ msg: "Identifying parcel…", loading: true, error: false });
      clearMap();
      const b = map.getBounds(), s = map.getSize();
      try {
        const params = new URLSearchParams({
          geometry: `${e.latlng.lng},${e.latlng.lat}`,
          geometryType: "esriGeometryPoint",
          sr: "4326",
          layers: "all:0",
          tolerance: "5",
          mapExtent: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(","),
          imageDisplay: `${s.x},${s.y},96`,
          returnGeometry: "true",
          f: "json",
        });
        const res = await fetch(`${BASE_IDENTIFY}?${params}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        const feats = (data.results || []).map((r) => ({ attributes: r.attributes, geometry: r.geometry }));
        setResults(feats);
        plotAll(feats);
        if (feats.length) setStatus({ msg: `${feats.length} parcel${feats.length > 1 ? "s" : ""} found`, loading: false, error: false });
        else setStatus({ msg: "No parcel at click point.", loading: false, error: false });
        if (feats.length === 1) selectResult(0, feats);
      } catch (err) {
        setStatus({ msg: `Error: ${err.message}`, loading: false, error: true });
      }
    };
    map.on("click", onClick);
    if (mode === "map") map.getContainer().style.cursor = "crosshair";
    else map.getContainer().style.cursor = "";
    return () => {
      map.off("click", onClick);
      map.getContainer().style.cursor = "";
    };
  }, [mode, mapRef]);

  const onDistrictChange = async (v) => {
    setDist(v); setVil(""); setQrtr(""); setVillages([]); setQuarters([]);
    if (!v) { setVilStatus(""); return; }
    setVilStatus("Loading villages…");
    try {
      const g = await fetchAllVillages();
      const list = g[v] || [];
      setVillages(list);
      setVilStatus(list.length ? `${list.length} villages loaded` : "No villages found");
      setTimeout(() => setVilStatus(""), 2000);
    } catch (e) {
      setVilStatus("Could not load: " + e.message);
    }
  };

  const onVillageChange = async (v) => {
    setVil(v); setQrtr(""); setQuarters([]);
    if (!dist || !v) return;
    try {
      const params = new URLSearchParams({
        f: "json",
        outFields: "QRTR_CODE,VIL_CODE,DIST_CODE,QRTR_NM_G",
        returnDistinctValues: "false",
        returnGeometry: "false",
        where: `DIST_CODE=${dist} AND VIL_CODE=${v}`,
      });
      const res = await fetch(`${QRTR_URL}?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const m = new Map();
      (data.features || []).forEach((f) => {
        const a = f.attributes;
        if (!m.has(a.QRTR_CODE)) m.set(a.QRTR_CODE, { code: a.QRTR_CODE, name: a.QRTR_NM_G || `Quarter ${a.QRTR_CODE}` });
      });
      setQuarters([...m.values()].sort((a, b) => a.name.localeCompare(b.name, "el")));
    } catch { /* ignore */ }
  };

  const buildWhere = () => {
    if (mode === "plan") {
      const p = plan.trim().replace(/'/g, "''");
      return p ? `PLAN_NBR LIKE '%${p}%'` : null;
    }
    if (mode === "reg") {
      const parts = [];
      if (regDist) parts.push(`DIST_CODE = ${parseInt(regDist)}`);
      if (regVil) parts.push(`VIL_CODE = ${parseInt(regVil)}`);
      if (regNo.trim()) {
        const n = regNo.trim().replace(/'/g, "''");
        // Try numeric match first, fallback to SBPI_ID_NO string
        parts.push(`(PARCEL_NBR = ${parseInt(n) || 0} OR SBPI_ID_NO LIKE '%${n}%')`);
      }
      return parts.length ? parts.join(" AND ") : null;
    }
    const parts = [];
    if (dist) parts.push(`DIST_CODE = ${parseInt(dist)}`);
    if (vil) parts.push(`VIL_CODE = ${parseInt(vil)}`);
    if (qrtr) parts.push(`QRTR_CODE = ${parseInt(qrtr)}`);
    if (blck) parts.push(`BLCK_CODE = ${parseInt(blck)}`);
    if (parcel) parts.push(`PARCEL_NBR = ${parseInt(parcel)}`);
    if (sheet.trim()) parts.push(`SHEET = '${sheet.trim().replace(/'/g, "''")}'`);
    return parts.length ? parts.join(" AND ") : null;
  };

  const clearMap = () => {
    if (layerRef.current) layerRef.current.clearLayers();
    if (selectedRef.current) { selectedRef.current.remove(); selectedRef.current = null; }
  };

  const plotAll = (feats) => {
    if (!layerRef.current) return;
    feats.forEach((f) => {
      const latlngs = ringToLatLng(f.geometry);
      if (latlngs) {
        L.polygon(latlngs, { color: "#6750a4", weight: 1.5, fillColor: "#6750a4", fillOpacity: 0.15 }).addTo(layerRef.current);
      }
    });
  };

  const selectResult = (idx, featsOverride) => {
    const feats = featsOverride || results;
    setActiveIdx(idx);
    if (selectedRef.current) { selectedRef.current.remove(); selectedRef.current = null; }
    const f = feats[idx];
    if (!f) return;
    const latlngs = ringToLatLng(f.geometry);
    if (latlngs && mapRef.current) {
      const poly = L.polygon(latlngs, { color: "#facc15", weight: 3, fillColor: "#facc15", fillOpacity: 0.3 }).addTo(mapRef.current);
      selectedRef.current = poly;
      mapRef.current.fitBounds(poly.getBounds(), { padding: [40, 40], maxZoom: 18 });
    }
    setDetailFor(f);
  };

  const doSearch = async () => {
    if (mode === "map") return;
    const w = buildWhere();
    if (!w) { setStatus({ msg: "Enter at least one filter.", loading: false, error: true }); return; }
    setStatus({ msg: "Searching…", loading: true, error: false });
    clearMap();
    setResults([]); setActiveIdx(-1); setDetailFor(null);
    try {
      const params = new URLSearchParams({
        where: w, outFields: "*", returnGeometry: "true",
        outSR: "4326", resultRecordCount: "200", f: "json",
      });
      const res = await fetch(`${BASE_QUERY}?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const feats = data.features || [];
      setResults(feats);
      plotAll(feats);
      if (feats.length) {
        setStatus({ msg: `${feats.length} result${feats.length > 1 ? "s" : ""}`, loading: false, error: false });
        if (feats.length === 1) selectResult(0, feats);
        else if (layerRef.current && mapRef.current) {
          const bounds = L.layerGroup(feats.filter(f => ringToLatLng(f.geometry)).map(f => L.polygon(ringToLatLng(f.geometry)))).getBounds();
          if (bounds.isValid()) mapRef.current.fitBounds(bounds, { padding: [40, 40] });
        }
      } else {
        setStatus({ msg: "No parcels found.", loading: false, error: false });
      }
    } catch (err) {
      setStatus({ msg: `Error: ${err.message}`, loading: false, error: true });
    }
  };

  const a = (detailFor?.attributes) || {};

  return (
    <div className="absolute top-3 left-3 z-[1000] w-80 max-h-[calc(100vh-24px)] flex flex-col">
      {/* MD3 FAB-style toggle button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "#6750a4",
          color: "#fff",
          borderRadius: "16px",
          padding: "10px 20px",
          boxShadow: "0 2px 8px rgba(103,80,164,0.4)",
          border: "none",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "14px",
          fontWeight: 500,
          fontFamily: "Roboto, sans-serif",
          cursor: "pointer",
          transition: "box-shadow 0.2s",
        }}
      >
        <Search style={{ width: 16, height: 16 }} />
        Parcel Search
        {open ? <ChevronUp style={{ width: 14, height: 14, marginLeft: "auto" }} /> : <ChevronDown style={{ width: 14, height: 14, marginLeft: "auto" }} />}
      </button>

      {open && (
        <div style={{
          marginTop: 8,
          background: "#ffffff",
          borderRadius: 20,
          boxShadow: "0 4px 20px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)",
          overflow: "hidden",
          overflowY: "auto",
          maxHeight: "calc(100vh - 100px)",
          fontFamily: "Roboto, sans-serif",
        }}>
          {/* Mode tabs — MD3 secondary tab style */}
          <div style={{ display: "flex", borderBottom: "1px solid #ede8f5" }}>
            {[
              { key: "codes", label: "By Codes", icon: <MapPin style={{ width: 13, height: 13 }} /> },
              { key: "plan",  label: "By Plan",  icon: <FileText style={{ width: 13, height: 13 }} /> },
              { key: "reg",   label: "By Reg.",  icon: <Search style={{ width: 13, height: 13 }} /> },
              { key: "map",   label: "Click Map", icon: <MousePointer style={{ width: 13, height: 13 }} /> },
            ].map((tab) => (
              <button key={tab.key} onClick={() => setMode(tab.key)} style={{
                flex: 1,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                padding: "10px 4px",
                fontSize: 11,
                fontWeight: mode === tab.key ? 600 : 400,
                color: mode === tab.key ? "#6750a4" : "#7c6fa0",
                background: "none", border: "none",
                borderBottom: mode === tab.key ? "2px solid #6750a4" : "2px solid transparent",
                cursor: "pointer",
                transition: "all 0.15s",
              }}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {mode === "codes" && (
              <>
                <select value={dist} onChange={(e) => onDistrictChange(e.target.value)} className={selectCls}>
                  <option value="">— District —</option>
                  {Object.entries(DIST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {vilStatus && <p style={{ fontSize: 10, color: "#9c8fba", margin: 0 }}>{vilStatus}</p>}
                <select value={vil} onChange={(e) => onVillageChange(e.target.value)} disabled={!villages.length} className={selectCls} style={{ opacity: villages.length ? 1 : 0.5 }}>
                  <option value="">— Village —</option>
                  {villages.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
                </select>
                {quarters.length > 0 && (
                  <select value={qrtr} onChange={(e) => setQrtr(e.target.value)} className={selectCls}>
                    <option value="">— Quarter —</option>
                    {quarters.map((q) => <option key={q.code} value={q.code}>{q.name}</option>)}
                  </select>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  <input placeholder="Block" value={blck} onChange={(e) => setBlck(e.target.value)} className={inputCls} />
                  <input placeholder="Parcel" value={parcel} onChange={(e) => setParcel(e.target.value)} className={inputCls} />
                  <input placeholder="Sheet" value={sheet} onChange={(e) => setSheet(e.target.value)} className={inputCls} />
                </div>
              </>
            )}
            {mode === "plan" && (
              <input placeholder="Plan number…" value={plan} onChange={(e) => setPlan(e.target.value)} className={inputCls} />
            )}
            {mode === "reg" && (
              <>
                <select value={regDist} onChange={(e) => { setRegDist(e.target.value); setRegVil(""); onDistrictChange(e.target.value); }} className={selectCls}>
                  <option value="">— Τμήμα Εγγραφής (District) —</option>
                  {Object.entries(DIST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={regVil} onChange={(e) => setRegVil(e.target.value)} disabled={!regDist} className={selectCls} style={{ opacity: regDist ? 1 : 0.5 }}>
                  <option value="">— Village Code (optional) —</option>
                  {Object.entries(DIST).length > 0 && regDist && villages.length === 0 && (
                    <option disabled>Load villages by selecting district in "By Codes" first</option>
                  )}
                  {villages.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
                </select>
                <input
                  placeholder="Registration / SBPI number…"
                  value={regNo}
                  onChange={(e) => setRegNo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                  className={inputCls}
                />
              </>
            )}
            {mode === "map" && (
              <p style={{ fontSize: 12, color: "#7c6fa0", textAlign: "center", padding: "8px 0", margin: 0 }}>
                Click anywhere on the map to identify a cadastral parcel.
              </p>
            )}

            {mode !== "map" && (
              <button onClick={doSearch} disabled={status.loading} style={{
                width: "100%", padding: "10px",
                background: "#6750a4", color: "#fff",
                borderRadius: 24, border: "none",
                fontSize: 13, fontWeight: 500,
                cursor: status.loading ? "not-allowed" : "pointer",
                opacity: status.loading ? 0.7 : 1,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                boxShadow: "0 1px 4px rgba(103,80,164,0.3)",
                transition: "opacity 0.15s",
                fontFamily: "Roboto, sans-serif",
              }}>
                {status.loading ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <Search style={{ width: 14, height: 14 }} />}
                Search
              </button>
            )}

            <p style={{ fontSize: 11, color: status.error ? "#d32f2f" : "#9c8fba", margin: 0, display: "flex", alignItems: "center", gap: 4 }}>
              {status.loading && <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />}
              {status.msg}
            </p>

            {/* Results list — MD3 list style */}
            {results.length > 1 && (
              <div style={{ border: "1px solid #ede8f5", borderRadius: 12, overflow: "hidden", maxHeight: 140, overflowY: "auto" }}>
                {results.map((f, i) => {
                  const a = f.attributes;
                  return (
                    <button key={i} onClick={() => selectResult(i)} style={{
                      width: "100%", textAlign: "left",
                      padding: "8px 12px", fontSize: 11,
                      background: i === activeIdx ? "#f0ebff" : "transparent",
                      color: i === activeIdx ? "#6750a4" : "#1a1625",
                      fontWeight: i === activeIdx ? 500 : 400,
                      border: "none", borderBottom: "1px solid #ede8f5",
                      cursor: "pointer", fontFamily: "Roboto, sans-serif",
                      transition: "background 0.1s",
                    }}>
                      D{a.DIST_CODE} · V{a.VIL_CODE} · B{a.BLCK_CODE} · P{a.PARCEL_NBR}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Detail card — MD3 surface variant */}
            {detailFor && (
              <div style={{
                background: "#f5f0ff", borderRadius: 16,
                padding: 12, fontSize: 12,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: "#1a1625", fontSize: 13 }}>Parcel Detail</span>
                  <button onClick={() => setDetailFor(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#7c6fa0" }}>
                    <X style={{ width: 14, height: 14 }} />
                  </button>
                </div>
                {[
                  ["District", DIST[a.DIST_CODE] || a.DIST_CODE],
                  ["Village Code", a.VIL_CODE],
                  ["Quarter", a.QRTR_CODE],
                  ["Block", a.BLCK_CODE],
                  ["Parcel No", a.PARCEL_NBR],
                  ["Sheet", a.SHEET || "—"],
                  ["Plan No", a.PLAN_NBR || "—"],
                  ["SBPI ID", a.SBPI_ID_NO || "—"],
                  a["SHAPE.STArea()"] && ["Area (m²)", Number(a["SHAPE.STArea()"]).toFixed(1)],
                ].filter(Boolean).map(([label, val]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #e8e0f5" }}>
                    <span style={{ color: "#7c6fa0" }}>{label}</span>
                    <span style={{ fontWeight: 500, color: "#1a1625" }}>{val}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}