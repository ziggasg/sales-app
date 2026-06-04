import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, Legend, ResponsiveContainer,
} from "recharts";
import { getPropertyData } from "@/functions/getPropertyData";
import { flagIcon, offPlanIcon, mercatorToLatLng, getLatLngCentroid, ringToLatLng } from "./MapHelpers";
import { buildDetailsHtml } from "./ParcelDetailsBuilder";
import ParcelSearch from "./ParcelSearch";
import { Layers, BarChart3, X, Loader2 } from "lucide-react";

// Cadastral parcel layer
function ParcelLayer({ fetchDetails }) {
  const map = useMap();
  useEffect(() => {
    const detailsCache = new Map();
    const inflight = new Map();
    const escapeHtml = (s) =>
      s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const formatLabel = (key) =>
      key.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

    const layer = L.layerGroup().addTo(map);
    let cancelled = false;
    const defaultStyle = { color: "#6750a4", weight: 1, fill: true, fillColor: "#6750a4", fillOpacity: 0.08 };
    const selectedStyle = { color: "#facc15", weight: 3, fill: true, fillColor: "#facc15", fillOpacity: 0.25 };
    let selected = null;
    const clearSelection = () => {
      if (selected) { selected.forEach((p) => p.setStyle(defaultStyle)); selected = null; }
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
          const a = f.attributes;
          const sbpiId = a.SBPI_ID_NO;
          const label = `D${a.DIST_CODE} V${a.VIL_CODE} Q${a.QRTR_CODE} B${a.BLCK_CODE} P${a.PARCEL_NBR}`;

          const rows = Object.entries(a)
            .filter(([k]) => !["OBJECTID", "Shape", "Shape_Length", "Shape_Area", "FID"].includes(k))
            .map(([k, v]) => {
              let val = v;
              if (typeof val === "number" && val > 1e12) try { val = new Date(val).toLocaleDateString("en-GB"); } catch {}
              return `<div class="flex justify-between gap-4"><span class="text-muted-foreground">${escapeHtml(formatLabel(k))}</span><span class="font-medium text-right">${val == null ? "—" : escapeHtml(String(val))}</span></div>`;
            }).join("");

          const detailsPlaceholder = sbpiId
            ? `<div id="sbpi-${sbpiId}" class="mt-2"><button class="sbpi-load text-[10px] text-blue-400 underline cursor-pointer" data-sbpi="${sbpiId}">Load property details…</button></div>`
            : "";

          poly.bindPopup(
            `<div class="text-xs space-y-0.5" style="min-width:220px;max-width:320px"><div class="font-semibold text-sm mb-1">${escapeHtml(label)}</div>${rows}${detailsPlaceholder}</div>`,
            { maxWidth: 350, maxHeight: 400 }
          );

          poly.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            clearSelection();
            poly.setStyle(selectedStyle);
            selected = [poly];
          });

          poly.on("popupopen", () => {
            if (!sbpiId) return;
            const container = document.getElementById(`sbpi-${sbpiId}`);
            if (!container) return;
            const btn = container.querySelector(".sbpi-load");
            if (!btn) return;
            btn.addEventListener("click", async () => {
              btn.textContent = "Loading…";
              btn.style.pointerEvents = "none";
              try {
                let html;
                if (detailsCache.has(String(sbpiId))) {
                  html = detailsCache.get(String(sbpiId));
                } else if (inflight.has(String(sbpiId))) {
                  html = await inflight.get(String(sbpiId));
                } else {
                  const p = fetchDetails(sbpiId).then((r) => {
                    const h = buildDetailsHtml(r);
                    detailsCache.set(String(sbpiId), h);
                    return h;
                  });
                  inflight.set(String(sbpiId), p);
                  html = await p;
                  inflight.delete(String(sbpiId));
                }
                container.innerHTML = html || '<div class="text-muted-foreground italic">No extra details</div>';
              } catch {
                container.innerHTML = '<div class="text-red-400 italic">Failed to load details</div>';
              }
            });
          });

          layer.addLayer(poly);
        });
      } catch { /* ignore */ }
    };

    load();
    map.on("moveend", load);
    return () => { cancelled = true; map.off("moveend", load); layer.remove(); };
  }, [map, fetchDetails]);
  return null;
}

// Legend overlay — MD3 surface card with toggleable layers
function MapLegend({ showProperties, showTransactions, onToggleProperties, onToggleTransactions }) {
  return (
    <div style={{
      position: "absolute", bottom: 32, right: 12, zIndex: 1000,
      background: "#fff", borderRadius: 16,
      boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
      padding: "12px 16px",
      fontFamily: "Roboto, sans-serif",
      fontSize: 12, minWidth: 170,
    }}>
      <div style={{ fontWeight: 600, color: "#1a1625", marginBottom: 8, fontSize: 13 }}>Legend</div>
      {[
        { color: "#ef4444", label: "Property Sale", active: showProperties, onToggle: onToggleProperties },
        { color: "#22c55e", label: "Off-plan Transaction", active: showTransactions, onToggle: onToggleTransactions },
      ].map(({ color, label, active, onToggle }) => (
        <button key={label} onClick={onToggle} style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
          background: "none", border: "none", cursor: "pointer", padding: 0, width: "100%",
          opacity: active ? 1 : 0.4, transition: "opacity 0.2s",
        }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: color, border: "2px solid #fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", display: "inline-block", flexShrink: 0 }} />
          <span style={{ color: "#5c4b8a", textDecoration: active ? "none" : "line-through", fontSize: 12 }}>{label}</span>
        </button>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: "rgba(103,80,164,0.15)", border: "1.5px solid #6750a4", display: "inline-block", flexShrink: 0 }} />
        <span style={{ color: "#5c4b8a" }}>Cadastral Parcel</span>
      </div>
    </div>
  );
}

export default function PropertyMap({ properties, transactions }) {
  const mapRef = useRef(null);
  const [showChart, setShowChart] = useState(false);
  const [showProperties, setShowProperties] = useState(true);
  const [showTransactions, setShowTransactions] = useState(true);

  const fetchDetails = async (sbpiId) => {
    const res = await getPropertyData({ action: "parcelDetails", sbpiId });
    return res.data?.raw || "";
  };

  // Chart data
  const chartData = useMemo(() => {
    const byMonth = {};
    properties.forEach((p) => {
      if (!p.sale_acceptance_date) return;
      const d = p.sale_acceptance_date.substring(0, 7);
      if (!byMonth[d]) byMonth[d] = { month: d, sales: 0, totalPrice: 0 };
      byMonth[d].sales++;
      byMonth[d].totalPrice += parseFloat(p.declared_price) || 0;
    });
    return Object.values(byMonth)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({ ...m, avgPrice: m.sales ? Math.round(m.totalPrice / m.sales) : 0 }));
  }, [properties]);

  // Popup builder for property markers
  const buildPropertyPopup = (p) => {
    const type = p.fiscal_property_type || "Unknown";
    const price = parseFloat(p.declared_price);
    const priceStr = !isNaN(price) ? `€${price.toLocaleString()}` : "N/A";
    const date = p.sale_acceptance_date || "N/A";
    const area = p.town_village_name || "Unknown";
    const block = p.block || "—";
    const reg = p.reg_no || "—";
    const mainCat = p.main_sbp_cat || "—";
    const mainKind = p.main_sbp_kind || "—";
    const enclosed = p.enclosed_ext || "—";
    const covered = p.covered_ext || "—";
    const row = (label, val) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:5px 0;border-bottom:1px solid #ede8f5"><span style="color:#7c6fa0">${label}</span><span style="font-weight:500;text-align:right;color:#1a1625">${val}</span></div>`;
    return `<div style="font-size:13px;line-height:1.6;min-width:340px;font-family:Roboto,sans-serif">
      <div style="font-size:15px;font-weight:700;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #ef4444;color:#1a1625">${type}</div>
      ${row("Price", `<span style="color:#16a34a;font-size:15px;font-weight:700">${priceStr}</span>`)}
      ${row("Sale Date", date)}
      ${row("Area / Village", area)}
      ${row("Block / Reg No", `${block} / ${reg}`)}
      ${row("Category", mainCat)}
      ${row("Kind", mainKind)}
      ${row("Enclosed Area", enclosed !== "—" ? `${enclosed} m²` : "—")}
      ${row("Covered Area", covered !== "—" ? `${covered} m²` : "—")}
    </div>`;
  };

  const buildTxPopup = (t) => {
    const amount = parseFloat(t.cos_amount);
    const amountStr = !isNaN(amount) ? `€${amount.toLocaleString()}` : "N/A";
    const row = (label, val) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:5px 0;border-bottom:1px solid #ede8f5"><span style="color:#7c6fa0">${label}</span><span style="font-weight:500;text-align:right;color:#1a1625">${val}</span></div>`;
    return `<div style="font-size:13px;line-height:1.6;min-width:340px;font-family:Roboto,sans-serif">
      <div style="font-size:15px;font-weight:700;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #22c55e;color:#1a1625">Off-plan Transaction</div>
      ${row("Amount", `<span style="color:#16a34a;font-size:15px;font-weight:700">${amountStr}</span>`)}
      ${row("Agreement Date", t.cos_agreement_date || "N/A")}
      ${row("Area / Village", t.town_village_name || "—")}
      ${row("Block / Reg No", `${t.block || "—"} / ${t.reg_no || "—"}`)}
      ${row("Share", `${t.share_numerator || "—"} / ${t.share_denominator || "—"}`)}
      ${t.remark1 ? `<div style="margin-top:8px;font-style:italic;color:#7c6fa0">${t.remark1}</div>` : ""}
    </div>`;
  };

  return (
    <div className="relative h-screen w-screen">
      <MapContainer
        center={[35.0, 33.4]}
        zoom={9}
        className="h-full w-full"
        ref={mapRef}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ParcelLayer fetchDetails={fetchDetails} />

        {/* Property markers */}
        {showProperties && properties.map((p, i) => {
          const lat = parseFloat(p.center_y);
          const lng = parseFloat(p.center_x);
          if (isNaN(lat) || isNaN(lng)) return null;
          return (
            <Marker key={`p-${i}`} position={[lat, lng]} icon={flagIcon}>
              <Popup maxWidth={480} minWidth={380}>
                <div dangerouslySetInnerHTML={{ __html: buildPropertyPopup(p) }} />
              </Popup>
            </Marker>
          );
        })}

        {/* Transaction markers */}
        {showTransactions && transactions.map((t, i) => {
          const lat = parseFloat(t.center_y);
          const lng = parseFloat(t.center_x);
          if (isNaN(lat) || isNaN(lng)) return null;
          return (
            <Marker key={`t-${i}`} position={[lat, lng]} icon={offPlanIcon}>
              <Popup maxWidth={480} minWidth={380}>
                <div dangerouslySetInnerHTML={{ __html: buildTxPopup(t) }} />
              </Popup>
            </Marker>
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

      {/* Chart toggle — MD3 FAB */}
      <button
        onClick={() => setShowChart(!showChart)}
        title="Price Trends"
        style={{
          position: "absolute", top: 12, right: 12, zIndex: 1000,
          background: "#6750a4", color: "#fff",
          border: "none", borderRadius: 16,
          width: 44, height: 44,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 8px rgba(103,80,164,0.4)",
          cursor: "pointer", transition: "box-shadow 0.2s",
        }}
      >
        <BarChart3 style={{ width: 20, height: 20 }} />
      </button>

      {/* Chart panel — MD3 surface card */}
      {showChart && (
        <div style={{
          position: "absolute", top: 64, right: 12, zIndex: 1000,
          width: 380, background: "#fff",
          borderRadius: 20,
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          padding: 16, fontFamily: "Roboto, sans-serif",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1a1625" }}>Monthly Average Sale Price</h3>
            <button onClick={() => setShowChart(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#7c6fa0" }}>
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ede8f5" />
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#9c8fba" }} />
                <YAxis tick={{ fontSize: 9, fill: "#9c8fba" }} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <ReTooltip
                  contentStyle={{ background: "#fff", border: "1px solid #ede8f5", borderRadius: 12, fontSize: 11, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}
                  labelStyle={{ color: "#1a1625", fontWeight: 600 }}
                  formatter={(v) => [`€${v.toLocaleString()}`, "Avg Price"]}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: "#7c6fa0" }} />
                <Line type="monotone" dataKey="avgPrice" name="Avg Price" stroke="#6750a4" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="sales" name="Sales Count" stroke="#ef4444" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}