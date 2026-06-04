import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { getPropertyData } from "@/functions/getPropertyData";

const BASE_QUERY = "https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer/0/query";
const VIL_URL = "https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/General_Search/MapServer/11/query";
const QRTR_URL = "https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/General_Search/MapServer/10/query";
const BASE_IDENTIFY = "https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer/identify";

const DIST = {
  1: "Nicosia", 2: "Kyrenia", 3: "Famagusta", 4: "Larnaca", 5: "Limassol", 6: "Paphos",
};

let villageCache = null;
let villageInflight = null;

async function fetchAllVillages() {
  if (villageCache) return villageCache;
  if (villageInflight) return villageInflight;
  villageInflight = (async () => {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "VIL_CODE,DIST_CODE,VIL_NM_G",
      returnDistinctValues: "false",
      returnGeometry: "false",
      resultRecordCount: "2000",
      f: "json",
    });
    const res = await fetch(`${VIL_URL}?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const grouped = {};
    for (const f of data.features || []) {
      const a = f.attributes;
      const d = String(a.DIST_CODE);
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push({ code: a.VIL_CODE, name: a.VIL_NM_G || `Village ${a.VIL_CODE}` });
    }
    for (const d of Object.keys(grouped)) grouped[d].sort((a, b) => a.name.localeCompare(b.name, "el"));
    villageCache = grouped;
    return grouped;
  })();
  return villageInflight;
}

function ringToLatLng(geom) {
  if (!geom) return null;
  const rings = geom.rings || geom.coordinates;
  if (!rings) return null;
  return rings.map((ring) => ring.map(([lng, lat]) => [lat, lng]));
}

function getLatLngCentroid(f) {
  const rings = f.geometry?.rings || f.geometry?.coordinates;
  if (!rings || !rings[0]) return null;
  const pts = rings[0];
  return {
    lat: pts.reduce((s, p) => s + p[1], 0) / pts.length,
    lng: pts.reduce((s, p) => s + p[0], 0) / pts.length,
  };
}

function fmtValue(v) {
  if (v == null || v === "") return "—";
  if (typeof v === "number" && v > 1e12) {
    try { return new Date(v).toLocaleDateString("en-GB"); } catch { /**/ }
  }
  return String(v);
}

const KNOWN_KEYS = new Set([
  "OBJECTID", "DIST_CODE", "VIL_CODE", "QRTR_CODE", "BLCK_CODE",
  "PARCEL_NBR", "SHEET", "PLAN_NBR", "SBPI_ID_NO", "SRC_SL_CODE",
  "SHAPE.STArea()", "Shape", "Shape_Length", "Shape_Area", "FID",
]);

export function ParcelSearch({ mapRef }) {
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
      const map2 = new Map();
      (data.features || []).forEach((f) => {
        const a = f.attributes;
        if (!map2.has(a.QRTR_CODE)) map2.set(a.QRTR_CODE, { code: a.QRTR_CODE, name: a.QRTR_NM_G || `Quarter ${a.QRTR_CODE}` });
      });
      setQuarters([...map2.values()].sort((a, b) => a.name.localeCompare(b.name, "el")));
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
    selectedRef.current = null;
  };

  const plotAll = (feats) => {
    if (!layerRef.current) return;
    layerRef.current.clearLayers();
    feats.forEach((f) => {
      const rings = ringToLatLng(f.geometry);
      if (!rings) return;
      L.polygon(rings, { color: "#00ffff", weight: 1, fillColor: "#00ffff", fillOpacity: 0.05 }).addTo(layerRef.current);
    });
  };

  const selectResult = (idx, feats) => {
    const list = feats || results;
    setActiveIdx(idx);
    const f = list[idx];
    if (!f) return;
    const rings = ringToLatLng(f.geometry);
    if (rings && layerRef.current) {
      layerRef.current.eachLayer((layer) => {
        if (layer instanceof L.Polygon) layer.setStyle({ color: "#00ffff", weight: 1, fillColor: "#00ffff", fillOpacity: 0.05 });
      });
      const polys = [];
      layerRef.current.eachLayer((layer, i) => {
        if (layer instanceof L.Polygon) polys.push(layer);
      });
      if (polys[idx]) {
        polys[idx].setStyle({ color: "#facc15", weight: 3, fillColor: "#facc15", fillOpacity: 0.25 });
        selectedRef.current = polys[idx];
      }
    }
    const c = getLatLngCentroid(f);
    if (c && mapRef.current) mapRef.current.setView([c.lat, c.lng], Math.max(mapRef.current.getZoom(), 17));
    setDetailFor(f);
  };

  const doSearch = async () => {
    const where = buildWhere();
    if (!where) {
      setStatus({ msg: "Please enter at least one search criterion.", loading: false, error: true });
      return;
    }
    setStatus({ msg: "Searching…", loading: true, error: false });
    setResults([]);
    setActiveIdx(-1);
    setDetailFor(null);
    clearMap();
    try {
      const params = new URLSearchParams({
        where,
        outFields: "*",
        returnGeometry: "true",
        f: "json",
        resultRecordCount: "50",
      });
      const res = await fetch(`${BASE_QUERY}?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const feats = data.features || [];
      setResults(feats);
      plotAll(feats);
      if (feats.length === 0) setStatus({ msg: "No parcels found.", loading: false, error: false });
      else {
        setStatus({ msg: `${feats.length} parcel${feats.length > 1 ? "s" : ""} found`, loading: false, error: false });
        if (feats.length === 1) selectResult(0, feats);
        else {
          const c = getLatLngCentroid(feats[0]);
          if (c && mapRef.current) mapRef.current.setView([c.lat, c.lng], 16);
        }
      }
    } catch (err) {
      setStatus({ msg: `Error: ${err.message}`, loading: false, error: true });
    }
  };

  const loadDetail = async (f) => {
    const sbpiId = f.attributes.SBPI_ID_NO;
    if (!sbpiId) { setDetailFor(f); return; }
    try {
      const res = await getPropertyData({ action: "parcelDetails", sbpiId });
      setDetailFor({ ...f, _detailRaw: res?.raw });
    } catch {
      setDetailFor(f);
    }
  };

  const knownFields = [
    ["District", "DIST_CODE", (v) => DIST[v] ?? fmtValue(v)],
    ["Village Code", "VIL_CODE"],
    ["Quarter Code", "QRTR_CODE"],
    ["Block", "BLCK_CODE"],
    ["Parcel No", "PARCEL_NBR"],
    ["Sheet", "SHEET"],
    ["Plan No", "PLAN_NBR"],
    ["SBPI ID", "SBPI_ID_NO"],
  ];

  const inputClass = "w-full rounded border border-border bg-secondary px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";
  const labelClass = "block text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5";
  const btnClass = "rounded px-3 py-1.5 text-xs font-medium transition-colors";

  return (
    <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-2" style={{ maxWidth: 320, width: "calc(100vw - 24px)" }}>
      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="self-start flex items-center gap-2 rounded-lg bg-card border border-border px-3 py-2 text-xs font-semibold text-foreground shadow-lg hover:bg-secondary transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        Parcel Search
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="rounded-lg bg-card border border-border shadow-xl overflow-hidden">
          {/* Mode tabs */}
          <div className="flex border-b border-border">
            {[["codes", "By Codes"], ["plan", "By Plan No"], ["map", "Click Map"]].map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wide transition-colors ${mode === m ? "bg-secondary text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-3 space-y-2.5">
            {mode === "codes" && (
              <>
                <div>
                  <label className={labelClass}>District</label>
                  <select className={inputClass} value={dist} onChange={(e) => onDistrictChange(e.target.value)}>
                    <option value="">— select —</option>
                    {Object.entries(DIST).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                {dist && (
                  <div>
                    <label className={labelClass}>Village {vilStatus && <span className="text-muted-foreground normal-case font-normal ml-1">({vilStatus})</span>}</label>
                    <select className={inputClass} value={vil} onChange={(e) => onVillageChange(e.target.value)}>
                      <option value="">— all —</option>
                      {villages.map((v) => (
                        <option key={v.code} value={v.code}>{v.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {vil && quarters.length > 0 && (
                  <div>
                    <label className={labelClass}>Quarter</label>
                    <select className={inputClass} value={qrtr} onChange={(e) => setQrtr(e.target.value)}>
                      <option value="">— all —</option>
                      {quarters.map((q) => (
                        <option key={q.code} value={q.code}>{q.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass}>Block</label>
                    <input type="number" className={inputClass} placeholder="e.g. 3" value={blck} onChange={(e) => setBlck(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass}>Parcel No</label>
                    <input type="number" className={inputClass} placeholder="e.g. 42" value={parcel} onChange={(e) => setParcel(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Sheet</label>
                  <input type="text" className={inputClass} placeholder="e.g. XXI/51" value={sheet} onChange={(e) => setSheet(e.target.value)} />
                </div>
              </>
            )}

            {mode === "plan" && (
              <div>
                <label className={labelClass}>Plan Number</label>
                <input type="text" className={inputClass} placeholder="e.g. Α.Σ. 1234" value={plan} onChange={(e) => setPlan(e.target.value)} />
              </div>
            )}

            {mode === "map" && (
              <p className="text-xs text-muted-foreground py-1">
                Click anywhere on the map to identify the cadastral parcel.
              </p>
            )}

            {mode !== "map" && (
              <div className="flex gap-2 pt-1">
                <button onClick={doSearch} className={`${btnClass} bg-primary text-primary-foreground hover:bg-primary/90 flex-1`}>
                  {status.loading ? "Searching…" : "Search"}
                </button>
                <button
                  onClick={() => { setResults([]); setActiveIdx(-1); setDetailFor(null); clearMap(); setStatus({ msg: "Select a district, then search.", loading: false, error: false }); }}
                  className={`${btnClass} bg-secondary text-foreground hover:bg-muted`}
                >
                  Clear
                </button>
              </div>
            )}

            {/* Status */}
            <p className={`text-[10px] ${status.error ? "text-destructive" : "text-muted-foreground"}`}>
              {status.loading ? "⏳ " : ""}{status.msg}
            </p>

            {/* Results list */}
            {results.length > 1 && (
              <div className="border border-border rounded overflow-hidden">
                <div className="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 bg-muted text-muted-foreground">
                  Results ({results.length})
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {results.map((f, i) => {
                    const a = f.attributes;
                    const label = [a.DIST_CODE && DIST[a.DIST_CODE], a.VIL_CODE && `V${a.VIL_CODE}`, a.PARCEL_NBR && `P${a.PARCEL_NBR}`, a.PLAN_NBR].filter(Boolean).join(" · ");
                    return (
                      <button
                        key={i}
                        onClick={() => selectResult(i)}
                        className={`w-full text-left px-2 py-1.5 text-xs border-t border-border transition-colors ${activeIdx === i ? "bg-secondary text-foreground" : "hover:bg-muted text-muted-foreground"}`}
                      >
                        {label || `Parcel ${i + 1}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Detail panel */}
            {detailFor && (
              <div className="border border-border rounded overflow-hidden">
                <div className="flex items-center justify-between px-2 py-1 bg-muted">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Parcel Info</span>
                  <button onClick={() => setDetailFor(null)} className="text-muted-foreground hover:text-foreground text-xs leading-none">✕</button>
                </div>
                <div className="p-2 space-y-1 text-xs">
                  {knownFields.map(([label, key, fmt]) => {
                    const val = detailFor.attributes[key];
                    if (val == null || val === "") return null;
                    return (
                      <div key={key} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium text-right">{fmt ? fmt(val) : fmtValue(val)}</span>
                      </div>
                    );
                  })}
                  {detailFor.attributes.SBPI_ID_NO && !detailFor._detailRaw && (
                    <button
                      onClick={() => loadDetail(detailFor)}
                      className="mt-1 text-[10px] text-ring hover:underline"
                    >
                      Load property details →
                    </button>
                  )}
                  {detailFor._detailRaw && (
                    <div className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground">
                      <div className="font-semibold text-foreground mb-1">Raw Property Data</div>
                      <pre className="whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{detailFor._detailRaw}</pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}