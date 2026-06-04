import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, Legend, ResponsiveContainer,
} from "recharts";
import { getPropertyData } from "@/functions/getPropertyData";
import { flagIcon, offPlanIcon, ringToLatLng } from "./MapHelpers";
import { buildDetailsHtml } from "./ParcelDetailsBuilder";
import ParcelSearch from "./ParcelSearch";
import NearbyAmenities from "./NearbyAmenities.jsx";
import { BarChart3, X, Loader2, MapPin } from "lucide-react";

// ── Bottom Sheet ─────────────────────────────────────────────────────────────
function BottomSheet({ title, accentColor, children, onClose }) {
  return (
    <div style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 2000,
      background: "#fff", borderRadius: "20px 20px 0 0",
      boxShadow: "0 -4px 24px rgba(0,0,0,0.18)",
      maxHeight: "60vh", display: "flex", flexDirection: "column",
      fontFamily: "Roboto, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 20px 12px",
        borderBottom: `3px solid ${accentColor}`,
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: "#1a1625" }}>{title}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <X style={{ width: 20, height: 20, color: "#7c6fa0" }} />
        </button>
      </div>
      {/* Scrollable body */}
      <div style={{ overflowY: "auto", padding: "16px 20px 32px", flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "10px 0", borderBottom: "1px solid #f0ebff", gap: 12,
    }}>
      <span style={{ color: "#7c6fa0", fontSize: 13, flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: 13, color: "#1a1625", textAlign: "right" }}>{value}</span>
    </div>
  );
}

// ── Cadastral parcel layer — fires onParcelClick instead of Leaflet popup ────
function ParcelLayer({ onParcelClick }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.layerGroup().addTo(map);
    let cancelled = false;
    const defaultStyle = { color: "#6750a4", weight: 1, fill: true, fillColor: "#6750a4", fillOpacity: 0.08 };
    const selectedStyle = { color: "#facc15", weight: 3, fill: true, fillColor: "#facc15", fillOpacity: 0.25 };
    let selected = null;
    const clearSelection = () => {
      if (selected) { selected.setStyle(defaultStyle); selected = null; }
    };

    const load = async () => {
      if (map.getZoom() < 15) { layer.clearLayers(); return; }
      const b = map.getBounds();
      const params = new URLSearchParams({
        where: "1=1", outFields: "*", returnGeometry: "true",
        geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326",
        geometry: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`,
        spatialRel: "esriSpatialRelIntersects", resultRecordCount: "500", f: "json",
      });
      try {
        const res = await fetch(`https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer/0/query?${params}`);
        const data = await res.json();
        if (cancelled || data.error) return;
        layer.clearLayers();
        (data.features || []).forEach((f) => {
          const latlngs = ringToLatLng(f.geometry);
          if (!latlngs) return;
          const poly = L.polygon(latlngs, defaultStyle);
          poly.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            clearSelection();
            poly.setStyle(selectedStyle);
            selected = poly;
            onParcelClick(f.attributes, f.geometry);
          });
          layer.addLayer(poly);
        });
      } catch { /* ignore */ }
    };

    load();
    map.on("moveend", load);
    return () => { cancelled = true; map.off("moveend", load); layer.remove(); };
  }, [map, onParcelClick]);
  return null;
}

// Dismiss sheet on map tap
function MapTapDismiss({ onTap }) {
  useMapEvents({ click: onTap });
  return null;
}

// Track map bounds on every move
function BoundsTracker({ onBoundsChange }) {
  const map = useMapEvents({
    moveend: () => onBoundsChange(map.getBounds()),
    zoomend: () => onBoundsChange(map.getBounds()),
  });
  useEffect(() => { onBoundsChange(map.getBounds()); }, []);
  return null;
}

// ── Legend ───────────────────────────────────────────────────────────────────
function MapLegend({ showProperties, showTransactions, onToggleProperties, onToggleTransactions }) {
  return (
    <div style={{
      position: "absolute", bottom: 24, right: 12, zIndex: 1000,
      background: "#fff", borderRadius: 14,
      boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
      padding: "10px 14px",
      fontFamily: "Roboto, sans-serif", fontSize: 12,
    }}>
      <div style={{ fontWeight: 600, color: "#1a1625", marginBottom: 8, fontSize: 13 }}>Layers</div>
      {[
        { color: "#ef4444", label: "Property Sale", active: showProperties, onToggle: onToggleProperties },
        { color: "#22c55e", label: "Off-plan", active: showTransactions, onToggle: onToggleTransactions },
      ].map(({ color, label, active, onToggle }) => (
        <button key={label} onClick={onToggle} style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
          background: "none", border: "none", cursor: "pointer", padding: 0, width: "100%",
          opacity: active ? 1 : 0.4, transition: "opacity 0.2s",
        }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: color, flexShrink: 0 }} />
          <span style={{ color: "#5c4b8a", textDecoration: active ? "none" : "line-through", fontSize: 12, whiteSpace: "nowrap" }}>{label}</span>
        </button>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: "rgba(103,80,164,0.15)", border: "1.5px solid #6750a4", flexShrink: 0 }} />
        <span style={{ color: "#5c4b8a", whiteSpace: "nowrap" }}>Cadastral</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PropertyMap({ properties, transactions }) {
  const mapRef = useRef(null);
  const [showChart, setShowChart] = useState(false);
  const [showProperties, setShowProperties] = useState(true);
  const [showTransactions, setShowTransactions] = useState(false);
  const [mapBounds, setMapBounds] = useState(null);

  // Bottom sheet state
  const [sheet, setSheet] = useState(null); // { type: 'parcel'|'property'|'transaction', data }
  const [parcelDetails, setParcelDetails] = useState(null); // { loading, html }
  const detailsCacheRef = useRef(new Map());

  const [showAmenities, setShowAmenities] = useState(false);
  const closeSheet = useCallback(() => { setSheet(null); setParcelDetails(null); setShowAmenities(false); }, []);

  const handleParcelClick = useCallback((attrs, geometry) => {
    let centroid = null;
    const rings = geometry?.rings || geometry?.coordinates;
    if (rings?.[0]?.length) {
      const pts = rings[0];
      centroid = [
        pts.reduce((s, p) => s + p[1], 0) / pts.length,
        pts.reduce((s, p) => s + p[0], 0) / pts.length,
      ];
    }
    setSheet({ type: "parcel", data: attrs, centroid });
    setParcelDetails(null);
    setShowAmenities(false);
    const sbpiId = attrs.SBPI_ID_NO;
    if (!sbpiId) return;
    if (detailsCacheRef.current.has(String(sbpiId))) {
      setParcelDetails({ loading: false, html: detailsCacheRef.current.get(String(sbpiId)) });
      return;
    }
    setParcelDetails({ loading: true, html: null });
    getPropertyData({ action: "parcelDetails", sbpiId })
      .then((res) => {
        const html = buildDetailsHtml(res.data?.raw || "");
        detailsCacheRef.current.set(String(sbpiId), html);
        setParcelDetails({ loading: false, html });
      })
      .catch(() => setParcelDetails({ loading: false, html: null }));
  }, []);

  // DLS cadastral district codes (matches ArcGIS CadastralMap_EN layer)
  const DIST = { 1: "Nicosia", 2: "Kyrenia", 3: "Famagusta", 4: "Larnaca", 5: "Limassol", 6: "Paphos" };

  // Chart data — from 2026-01-01, one avg price line per parcel type
  const ALLOWED_TYPES = new Set(["ΓΡΑΦΕΙΟ","ΔΙΑΜΕΡΙΣΜΑ","ΔΙΟΡΟΦΗ ΚΑΤΟΙΚΙΑ","ΙΣΟΓΕΙΑ ΚΑΤΟΙΚΙΑ","ΚΑΤΑΣΤΗΜΑ","ΟΙΚΟΠΕΔΟ","ΧΩΡΑΦΙ"]);

  const { chartData, chartTypes } = useMemo(() => {
    const byMonth = {};
    const typesSet = new Set();

    properties.forEach((p) => {
      if (!p.sale_acceptance_date) return;
      if (p.sale_acceptance_date < "2026-01-01") return;
      // Filter to map viewport
      if (mapBounds) {
        const lat = parseFloat(p.center_y), lng = parseFloat(p.center_x);
        if (isNaN(lat) || isNaN(lng)) return;
        if (!mapBounds.contains([lat, lng])) return;
      }
      const month = p.sale_acceptance_date.substring(0, 7);
      const type = p.fiscal_property_type || p.main_sbp_cat || "Other";
      if (!ALLOWED_TYPES.has(type)) return;
      typesSet.add(type);
      if (!byMonth[month]) byMonth[month] = { month };
      if (!byMonth[month][`${type}_prices`]) byMonth[month][`${type}_prices`] = [];
      const price = parseFloat(p.declared_price);
      if (isNaN(price) || price <= 0) return;

      // Area calculation: for apartments sum enclosed + covered, else use enclosed or covered
      let area = null;
      const enclosed = parseFloat(p.enclosed_ext);
      const covered = parseFloat(p.covered_ext);
      if (type === "ΔΙΑΜΕΡΙΣΜΑ") {
        const e = isNaN(enclosed) ? 0 : enclosed;
        const c = isNaN(covered) ? 0 : covered;
        area = e + c > 0 ? e + c : null;
      } else {
        area = !isNaN(enclosed) && enclosed > 0 ? enclosed
             : !isNaN(covered) && covered > 0 ? covered
             : null;
      }
      if (!area) return;

      byMonth[month][`${type}_prices`].push(price / area);
    });

    const median = (arr) => {
      if (!arr.length) return null;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    };

    const types = Array.from(typesSet).sort();
    const data = Object.values(byMonth)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => {
        const row = { month: m.month };
        types.forEach((t) => {
          row[t] = median(m[`${t}_prices`] || []);
        });
        return row;
      });

    return { chartData: data, chartTypes: types };
  }, [properties, mapBounds]);

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <MapContainer
        center={[34.775, 32.424]}
        zoom={14}
        style={{ width: "100%", height: "100%" }}
        ref={mapRef}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ParcelLayer onParcelClick={handleParcelClick} />
        <MapTapDismiss onTap={closeSheet} />
        <BoundsTracker onBoundsChange={setMapBounds} />

        {showProperties && properties.map((p, i) => {
          const lat = parseFloat(p.center_y), lng = parseFloat(p.center_x);
          if (isNaN(lat) || isNaN(lng)) return null;
          return (
            <Marker key={`p-${i}`} position={[lat, lng]} icon={flagIcon}
              eventHandlers={{ click: () => setSheet({ type: "property", data: p }) }}
            />
          );
        })}

        {showTransactions && transactions.map((t, i) => {
          const lat = parseFloat(t.center_y), lng = parseFloat(t.center_x);
          if (isNaN(lat) || isNaN(lng)) return null;
          return (
            <Marker key={`t-${i}`} position={[lat, lng]} icon={offPlanIcon}
              eventHandlers={{ click: () => setSheet({ type: "transaction", data: t }) }}
            />
          );
        })}
      </MapContainer>

      {/* Parcel Search */}
      <ParcelSearch mapRef={mapRef} />

      {/* Legend */}
      <MapLegend
        showProperties={showProperties}
        showTransactions={showTransactions}
        onToggleProperties={() => setShowProperties(v => !v)}
        onToggleTransactions={() => setShowTransactions(v => !v)}
      />

      {/* Chart FAB */}
      <button
        onClick={() => setShowChart(!showChart)}
        title="Price Trends"
        style={{
          position: "absolute", top: 12, right: 12, zIndex: 1000,
          background: "#6750a4", color: "#fff",
          border: "none", borderRadius: 16, width: 44, height: 44,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 8px rgba(103,80,164,0.4)", cursor: "pointer",
        }}
      >
        <BarChart3 style={{ width: 20, height: 20 }} />
      </button>

      {/* Chart panel */}
      {showChart && (
        <div style={{
          position: "absolute", top: 64, right: 12, left: 12, zIndex: 1000,
          background: "#fff", borderRadius: 20,
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          padding: 16, fontFamily: "Roboto, sans-serif",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1a1625" }}>Monthly Median Sale Price per m²</h3>
            <button onClick={() => setShowChart(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#7c6fa0" }}>
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ede8f5" />
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#9c8fba" }} />
                <YAxis tick={{ fontSize: 9, fill: "#9c8fba" }} tickFormatter={(v) => `€${Math.round(v).toLocaleString()}`} />
                <ReTooltip
                  contentStyle={{ background: "#fff", border: "1px solid #ede8f5", borderRadius: 12, fontSize: 11 }}
                  formatter={(v, name) => v != null ? [`€${Math.round(v).toLocaleString()}/m²`, name] : [null, name]}
                />
                <Legend wrapperStyle={{ fontSize: 9, color: "#7c6fa0" }} />
                {chartTypes.map((type, i) => {
                  const colors = ["#6750a4","#ef4444","#22c55e","#f59e0b","#3b82f6","#ec4899","#14b8a6","#f97316"];
                  return (
                    <Line
                      key={type}
                      type="monotone"
                      dataKey={type}
                      name={type}
                      stroke={colors[i % colors.length]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Bottom Sheets ── */}

      {/* Parcel */}
      {sheet?.type === "parcel" && (
        <BottomSheet
          title={`Block ${sheet.data.BLCK_CODE} · Parcel ${sheet.data.PARCEL_NBR}`}
          accentColor="#6750a4"
          onClose={closeSheet}
        >
          <InfoRow label="District" value={DIST[sheet.data.DIST_CODE] || sheet.data.DIST_CODE} />
          <InfoRow label="Village Code" value={sheet.data.VIL_CODE} />
          <InfoRow label="Quarter" value={sheet.data.QRTR_CODE} />
          <InfoRow label="Block" value={sheet.data.BLCK_CODE} />
          <InfoRow label="Parcel No" value={sheet.data.PARCEL_NBR} />
          <InfoRow label="Sheet" value={sheet.data.SHEET || "—"} />
          <InfoRow label="Plan No" value={sheet.data.PLAN_NBR || "—"} />
          <InfoRow label="SBPI ID" value={sheet.data.SBPI_ID_NO || "—"} />
          {sheet.data["SHAPE.STArea()"] && (
            <InfoRow label="Area (m²)" value={Number(sheet.data["SHAPE.STArea()"]).toFixed(1)} />
          )}
          {/* Property details */}
          {sheet.data.SBPI_ID_NO && (
            <div style={{ marginTop: 16 }}>
              {parcelDetails?.loading && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#7c6fa0", fontSize: 13 }}>
                  <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> Loading property details…
                </div>
              )}
              {parcelDetails && !parcelDetails.loading && parcelDetails.html && (
                <div dangerouslySetInnerHTML={{ __html: parcelDetails.html }} />
              )}
              {parcelDetails && !parcelDetails.loading && !parcelDetails.html && (
                <p style={{ color: "#9c8fba", fontSize: 13, fontStyle: "italic" }}>No additional property details.</p>
              )}
            </div>
          )}
          {sheet?.centroid && !showAmenities && (
            <button
              onClick={() => setShowAmenities(true)}
              style={{
                marginTop: 20, width: "100%", padding: "10px",
                background: "#f5f0ff", color: "#6750a4",
                border: "1.5px solid #d8d0f0", borderRadius: 24,
                fontSize: 13, fontWeight: 500, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                fontFamily: "Roboto, sans-serif",
              }}
            >
              <MapPin style={{ width: 14, height: 14 }} />
              Show Nearby Amenities
            </button>
          )}
          {sheet?.centroid && showAmenities && (
            <NearbyAmenities lat={sheet.centroid[0]} lon={sheet.centroid[1]} />
          )}
        </BottomSheet>
      )}

      {/* Property Sale */}
      {sheet?.type === "property" && (() => {
        const p = sheet.data;
        const price = parseFloat(p.declared_price);
        return (
          <BottomSheet title={p.fiscal_property_type || "Property Sale"} accentColor="#ef4444" onClose={closeSheet}>
            <InfoRow label="Price" value={!isNaN(price) ? `€${price.toLocaleString()}` : "N/A"} />
            <InfoRow label="Sale Date" value={p.sale_acceptance_date || "N/A"} />
            <InfoRow label="Area / Village" value={p.town_village_name || "—"} />
            <InfoRow label="Block / Reg No" value={`${p.block || "—"} / ${p.reg_no || "—"}`} />
            <InfoRow label="Category" value={p.main_sbp_cat || "—"} />
            <InfoRow label="Kind" value={p.main_sbp_kind || "—"} />
            {p.enclosed_ext && <InfoRow label="Enclosed Area" value={`${p.enclosed_ext} m²`} />}
            {p.covered_ext && <InfoRow label="Covered Area" value={`${p.covered_ext} m²`} />}
          </BottomSheet>
        );
      })()}

      {/* Off-plan Transaction */}
      {sheet?.type === "transaction" && (() => {
        const t = sheet.data;
        const amount = parseFloat(t.cos_amount);
        return (
          <BottomSheet title="Off-plan Transaction" accentColor="#22c55e" onClose={closeSheet}>
            <InfoRow label="Amount" value={!isNaN(amount) ? `€${amount.toLocaleString()}` : "N/A"} />
            <InfoRow label="Agreement Date" value={t.cos_agreement_date || "N/A"} />
            <InfoRow label="Area / Village" value={t.town_village_name || "—"} />
            <InfoRow label="Block / Reg No" value={`${t.block || "—"} / ${t.reg_no || "—"}`} />
            <InfoRow label="Share" value={`${t.share_numerator || "—"} / ${t.share_denominator || "—"}`} />
            {t.remark1 && <p style={{ marginTop: 12, fontStyle: "italic", color: "#7c6fa0", fontSize: 13 }}>{t.remark1}</p>}
          </BottomSheet>
        );
      })()}
    </div>
  );
}