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
    const defaultStyle = { color: "#00ffff", weight: 1, fill: true, fillColor: "#00ffff", fillOpacity: 0.05 };
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

// Legend overlay
function MapLegend() {
  return (
    <div className="absolute bottom-8 right-3 z-[1000] bg-card/95 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg text-xs space-y-1.5">
      <div className="font-semibold text-foreground mb-1">Legend</div>
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full bg-red-500 border border-white shadow-sm inline-block" />
        <span className="text-muted-foreground">Property Sale</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full bg-green-500 border border-white shadow-sm inline-block" />
        <span className="text-muted-foreground">Off-plan Transaction</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 inline-block border border-cyan-400" style={{ background: "rgba(0,255,255,0.1)" }} />
        <span className="text-muted-foreground">Cadastral Parcel</span>
      </div>
    </div>
  );
}

export default function PropertyMap({ properties, transactions }) {
  const mapRef = useRef(null);
  const [showChart, setShowChart] = useState(false);

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
    return `<div class="text-xs space-y-1" style="min-width:200px">
      <div class="font-semibold text-sm">${type}</div>
      <div class="flex justify-between"><span class="text-muted-foreground">Price</span><span class="font-medium text-green-400">${priceStr}</span></div>
      <div class="flex justify-between"><span class="text-muted-foreground">Date</span><span>${date}</span></div>
      <div class="flex justify-between"><span class="text-muted-foreground">Area</span><span>${area}</span></div>
      <div class="flex justify-between"><span class="text-muted-foreground">Block / Reg</span><span>${block} / ${reg}</span></div>
      <div class="flex justify-between"><span class="text-muted-foreground">Category</span><span>${mainCat}</span></div>
      <div class="flex justify-between"><span class="text-muted-foreground">Kind</span><span>${mainKind}</span></div>
      <div class="flex justify-between"><span class="text-muted-foreground">Enclosed</span><span>${enclosed} m²</span></div>
      <div class="flex justify-between"><span class="text-muted-foreground">Covered</span><span>${covered} m²</span></div>
    </div>`;
  };

  const buildTxPopup = (t) => {
    const amount = parseFloat(t.cos_amount);
    const amountStr = !isNaN(amount) ? `€${amount.toLocaleString()}` : "N/A";
    return `<div class="text-xs space-y-1" style="min-width:200px">
      <div class="font-semibold text-sm text-green-400">Off-plan Transaction</div>
      <div class="flex justify-between"><span class="text-muted-foreground">Amount</span><span class="font-medium text-green-400">${amountStr}</span></div>
      <div class="flex justify-between"><span class="text-muted-foreground">Date</span><span>${t.cos_agreement_date || "N/A"}</span></div>
      <div class="flex justify-between"><span class="text-muted-foreground">Area</span><span>${t.town_village_name || "—"}</span></div>
      <div class="flex justify-between"><span class="text-muted-foreground">Block / Reg</span><span>${t.block || "—"} / ${t.reg_no || "—"}</span></div>
      <div class="flex justify-between"><span class="text-muted-foreground">Share</span><span>${t.share_numerator || "—"}/${t.share_denominator || "—"}</span></div>
      ${t.remark1 ? `<div class="text-muted-foreground italic mt-1">${t.remark1}</div>` : ""}
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
          attribution='&copy; <a href="https://carto.com">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <ParcelLayer fetchDetails={fetchDetails} />

        {/* Property markers */}
        {properties.map((p, i) => {
          const [lat, lng] = mercatorToLatLng(parseFloat(p.center_x), parseFloat(p.center_y));
          if (isNaN(lat) || isNaN(lng)) return null;
          return (
            <Marker key={`p-${i}`} position={[lat, lng]} icon={flagIcon}>
              <Popup maxWidth={320}>
                <div dangerouslySetInnerHTML={{ __html: buildPropertyPopup(p) }} />
              </Popup>
            </Marker>
          );
        })}

        {/* Transaction markers */}
        {transactions.map((t, i) => {
          const [lat, lng] = mercatorToLatLng(parseFloat(t.center_x), parseFloat(t.center_y));
          if (isNaN(lat) || isNaN(lng)) return null;
          return (
            <Marker key={`t-${i}`} position={[lat, lng]} icon={offPlanIcon}>
              <Popup maxWidth={320}>
                <div dangerouslySetInnerHTML={{ __html: buildTxPopup(t) }} />
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Parcel Search */}
      <ParcelSearch mapRef={mapRef} />

      {/* Legend */}
      <MapLegend />

      {/* Chart toggle */}
      <button
        onClick={() => setShowChart(!showChart)}
        className="absolute top-3 right-3 z-[1000] p-2 bg-card/95 backdrop-blur-sm border border-border rounded-lg text-foreground hover:bg-accent transition-colors shadow-lg"
        title="Price Trends"
      >
        <BarChart3 className="w-5 h-5" />
      </button>

      {/* Chart panel */}
      {showChart && (
        <div className="absolute top-14 right-3 z-[1000] w-96 bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-foreground">Monthly Average Sale Price</h3>
            <button onClick={() => setShowChart(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 28% 25%)" />
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: "hsl(215 20% 65%)" }} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(215 20% 65%)" }} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <ReTooltip
                  contentStyle={{ background: "hsl(217 33% 17%)", border: "1px solid hsl(215 28% 25%)", borderRadius: "0.5rem", fontSize: 11 }}
                  labelStyle={{ color: "hsl(210 40% 98%)" }}
                  formatter={(v) => [`€${v.toLocaleString()}`, "Avg Price"]}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="avgPrice" name="Avg Price" stroke="#22c55e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="sales" name="Sales Count" stroke="#ef4444" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}