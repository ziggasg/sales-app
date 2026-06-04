import L from "leaflet";

// Dot icon factory
export const makeDot = (color) =>
  L.divIcon({
    className: "property-dot-icon",
    html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });

export const flagIcon = makeDot("#ef4444");
export const offPlanIcon = makeDot("#22c55e");

// Web Mercator → LatLng
export function mercatorToLatLng(x, y) {
  const lng = (x * 180) / 20037508.34;
  let lat = (y * 180) / 20037508.34;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return [lat, lng];
}

// District codes
export const DIST = {
  1: "Nicosia", 2: "Kyrenia", 3: "Famagusta", 4: "Larnaca", 5: "Limassol", 6: "Paphos",
};

// Source scale codes
export const SRC = {
  0: "Missing", 1: "Cassini 1:500", 2: "Cassini 1:1000", 3: "Cassini 1:1250",
  4: "Cassini 1:2500", 5: "Cassini 1:5000", 6: "LTM 1:1000", 7: "LTM 1:2000", 8: "LTM 1:5000",
};

// ArcGIS URLs
export const BASE_QUERY = "https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer/0/query";
export const VIL_URL = "https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/General_Search/MapServer/11/query";
export const QRTR_URL = "https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/General_Search/MapServer/10/query";
export const BASE_IDENTIFY = "https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer/identify";

// Geometry helpers
export function ringToLatLng(geom) {
  if (!geom) return null;
  const rings = geom.rings || geom.coordinates;
  if (!rings) return null;
  return rings.map((ring) => ring.map(([lng, lat]) => [lat, lng]));
}

export function getLatLngCentroid(f) {
  const rings = f.geometry?.rings || f.geometry?.coordinates;
  if (!rings || !rings[0]) return null;
  const pts = rings[0];
  return {
    lat: pts.reduce((s, p) => s + p[1], 0) / pts.length,
    lng: pts.reduce((s, p) => s + p[0], 0) / pts.length,
  };
}

// Format helpers
export function fmtLabel(k) {
  return k.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function fmtValue(v) {
  if (v == null || v === "") return "—";
  if (typeof v === "number" && v > 1e12) {
    try { return new Date(v).toLocaleDateString("en-GB"); } catch { /* */ }
  }
  return String(v);
}

export const KNOWN_KEYS = new Set([
  "OBJECTID", "DIST_CODE", "VIL_CODE", "QRTR_CODE", "BLCK_CODE",
  "PARCEL_NBR", "SHEET", "PLAN_NBR", "SBPI_ID_NO", "SRC_SL_CODE",
  "SHAPE.STArea()", "Shape", "Shape_Length", "Shape_Area", "FID",
]);

// Village cache
let villageCache = null;
let villageInflight = null;

export async function fetchAllVillages() {
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