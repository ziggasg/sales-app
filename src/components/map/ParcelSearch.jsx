import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Search, MapPin, FileText, MousePointer, ChevronDown, ChevronUp, X, Loader2 } from "lucide-react";
import {
  DIST, SRC, BASE_QUERY, BASE_IDENTIFY, QRTR_URL,
  fetchAllVillages, ringToLatLng, getLatLngCentroid,
  KNOWN_KEYS, fmtLabel, fmtValue,
} from "./MapHelpers";

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
        L.polygon(latlngs, { color: "#00ffff", weight: 1.5, fillColor: "#00ffff", fillOpacity: 0.15 }).addTo(layerRef.current);
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
        where: w,
        outFields: "*",
        returnGeometry: "true",
        outSR: "4326",
        resultRecordCount: "200",
        f: "json",
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
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 bg-card/95 backdrop-blur-sm border border-border rounded-lg text-sm font-medium text-foreground hover:bg-accent transition-colors shadow-lg"
      >
        <Search className="w-4 h-4" />
        Parcel Search
        {open ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
      </button>

      {open && (
        <div className="mt-2 bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-xl overflow-y-auto text-xs">
          {/* Mode tabs */}
          <div className="flex border-b border-border">
            {[
              { key: "codes", label: "By Codes", icon: <MapPin className="w-3 h-3" /> },
              { key: "plan", label: "By Plan", icon: <FileText className="w-3 h-3" /> },
              { key: "map", label: "Click Map", icon: <MousePointer className="w-3 h-3" /> },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setMode(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1 py-2 px-1 text-xs font-medium transition-colors
                  ${mode === tab.key ? "bg-accent text-foreground border-b-2 border-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          <div className="p-3 space-y-2">
            {mode === "codes" && (
              <>
                <select value={dist} onChange={(e) => onDistrictChange(e.target.value)}
                  className="w-full px-2 py-1.5 bg-secondary border border-border rounded text-foreground text-xs">
                  <option value="">— District —</option>
                  {Object.entries(DIST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {vilStatus && <p className="text-[10px] text-muted-foreground">{vilStatus}</p>}
                <select value={vil} onChange={(e) => onVillageChange(e.target.value)} disabled={!villages.length}
                  className="w-full px-2 py-1.5 bg-secondary border border-border rounded text-foreground text-xs disabled:opacity-50">
                  <option value="">— Village —</option>
                  {villages.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
                </select>
                {quarters.length > 0 && (
                  <select value={qrtr} onChange={(e) => setQrtr(e.target.value)}
                    className="w-full px-2 py-1.5 bg-secondary border border-border rounded text-foreground text-xs">
                    <option value="">— Quarter —</option>
                    {quarters.map((q) => <option key={q.code} value={q.code}>{q.name}</option>)}
                  </select>
                )}
                <div className="grid grid-cols-3 gap-1">
                  <input placeholder="Block" value={blck} onChange={(e) => setBlck(e.target.value)}
                    className="px-2 py-1.5 bg-secondary border border-border rounded text-foreground text-xs" />
                  <input placeholder="Parcel" value={parcel} onChange={(e) => setParcel(e.target.value)}
                    className="px-2 py-1.5 bg-secondary border border-border rounded text-foreground text-xs" />
                  <input placeholder="Sheet" value={sheet} onChange={(e) => setSheet(e.target.value)}
                    className="px-2 py-1.5 bg-secondary border border-border rounded text-foreground text-xs" />
                </div>
              </>
            )}
            {mode === "plan" && (
              <input placeholder="Plan number…" value={plan} onChange={(e) => setPlan(e.target.value)}
                className="w-full px-2 py-1.5 bg-secondary border border-border rounded text-foreground text-xs" />
            )}
            {mode === "map" && (
              <p className="text-muted-foreground text-center py-2">Click on the map to identify a parcel.</p>
            )}

            {mode !== "map" && (
              <button onClick={doSearch} disabled={status.loading}
                className="w-full py-1.5 bg-foreground text-background rounded text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1">
                {status.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                Search
              </button>
            )}

            {/* Status */}
            <p className={`text-[10px] ${status.error ? "text-red-400" : "text-muted-foreground"}`}>
              {status.loading && <Loader2 className="w-3 h-3 inline animate-spin mr-1" />}
              {status.msg}
            </p>

            {/* Results list */}
            {results.length > 1 && (
              <div className="border border-border rounded max-h-32 overflow-y-auto">
                {results.map((f, i) => {
                  const a = f.attributes;
                  return (
                    <button key={i} onClick={() => selectResult(i)}
                      className={`w-full text-left px-2 py-1 text-[10px] hover:bg-accent transition-colors border-b border-border last:border-0
                        ${i === activeIdx ? "bg-accent font-medium" : ""}`}>
                      D{a.DIST_CODE} V{a.VIL_CODE} Q{a.QRTR_CODE} B{a.BLCK_CODE} P{a.PARCEL_NBR}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Detail view */}
            {detailFor && (
              <div className="border border-border rounded p-2 space-y-1">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-foreground">Parcel Detail</span>
                  <button onClick={() => setDetailFor(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="space-y-0.5 text-[10px]">
                  <div className="flex justify-between"><span className="text-muted-foreground">District</span><span>{DIST[a.DIST_CODE] || a.DIST_CODE}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Village</span><span>{a.VIL_CODE}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Quarter</span><span>{a.QRTR_CODE}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Block</span><span>{a.BLCK_CODE}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Parcel</span><span>{a.PARCEL_NBR}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Sheet</span><span>{a.SHEET || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Plan</span><span>{a.PLAN_NBR || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">SBPI ID</span><span>{a.SBPI_ID_NO || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Source</span><span>{SRC[a.SRC_SL_CODE] || a.SRC_SL_CODE}</span></div>
                  {a["SHAPE.STArea()"] && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Area (m²)</span><span>{Number(a["SHAPE.STArea()"]).toFixed(1)}</span></div>
                  )}
                  {/* Extra keys */}
                  {Object.entries(a).filter(([k]) => !KNOWN_KEYS.has(k)).map(([k, v]) => (
                    <div key={k} className="flex justify-between"><span className="text-muted-foreground">{fmtLabel(k)}</span><span>{fmtValue(v)}</span></div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}