import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { getPropertyData } from "@/functions/getPropertyData";
import { ParcelSearch } from "./ParcelSearch";

const makeDot = (color) =>
  L.divIcon({
    className: "property-dot-icon",
    html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });

const flagIcon = makeDot("#ef4444");
const offPlanIcon = makeDot("#22c55e");

function mercatorToLatLng(x, y) {
  const lng = (x * 180) / 20037508.34;
  let lat = (y * 180) / 20037508.34;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return [lat, lng];
}

function ParcelLayer() {
  const map = useMap();

  useEffect(() => {
    const detailsCache = new Map();
    const inflight = new Map();
    const escapeHtml = (s) =>
      s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const pickName = (o) => {
      if (!o || typeof o !== "object") return null;
      const r = o;
      const v = r.NameEn ?? r.PrNameEn ?? r.Name;
      return typeof v === "string" ? v.trim() : null;
    };

    const buildDetailsHtml = (raw) => {
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return ""; }
      const arr = (Array.isArray(parsed) ? parsed : [parsed]);
      if (!arr.length) return `<div class="text-muted-foreground italic">No additional details</div>`;

      const isParcel = (p) => {
        const t = (pickName(p.PrPropertyType) ?? "").toLowerCase();
        return t.includes("parcel");
      };
      const parcelIdOf = (p) => {
        const v = p.PrParcelId ?? p.PrParcelID ?? p.PrParcelNo;
        return v == null ? "" : String(v);
      };

      const parcels = arr.filter(isParcel);
      const units = arr.filter((p) => !isParcel(p));
      const groups = [];
      parcels.forEach((p) => groups.push({ parcel: p, units: [], key: parcelIdOf(p) }));
      units.forEach((u) => {
        const k = parcelIdOf(u);
        const g = groups.find((x) => x.key && x.key === k);
        if (g) g.units.push(u);
        else groups.push({ parcel: null, units: [u], key: k });
      });
      if (!groups.length) arr.forEach((p) => groups.push({ parcel: p, units: [], key: parcelIdOf(p) }));

      const row = (label, val) => {
        if (val == null || val === "") return "";
        return `<div class="flex justify-between gap-4"><span class="text-muted-foreground">${escapeHtml(label)}</span><span class="font-medium text-right">${escapeHtml(String(val))}</span></div>`;
      };

      const renderProp = (p, isUnit, parent) => {
        const typeName = pickName(p.PrPropertyType);
        const kindName = pickName(p.PrSubPropertyKind);
        const headerBits = [typeName, kindName].filter(Boolean).join(" — ");

        const sameAsParent = (key, val) => {
          if (!parent) return false;
          const pv = parent[key];
          if (pv == null || val == null) return false;
          return String(pv) === String(val);
        };
        const sameNameAsParent = (key, val) => {
          if (!parent || !val) return false;
          return pickName(parent[key]) === val;
        };
        const addRow = (label, key, val) => sameAsParent(key, val) ? "" : row(label, val);
        const addNameRow = (label, key, val) => sameNameAsParent(key, val) ? "" : row(label, val);

        const rows = [];
        rows.push(addRow("Registration No", "PrRegistrationNo", p.PrRegistrationNo));
        rows.push(addRow("Parcel No", "PrParcelNo", p.PrParcelNo));
        rows.push(addRow("Flat No", "PrFlatNo", p.PrFlatNo));
        rows.push(addNameRow("District", "PrDistrict", pickName(p.PrDistrict)));
        rows.push(addNameRow("Municipality", "PrMunicipality", pickName(p.PrMunicipality)));
        rows.push(addRow("Location", "PrLocation", p.PrLocation));
        rows.push(addRow("Extents (m²)", "PrExtents", p.PrExtents));
        rows.push(addRow("Price Base 1", "PrPriceBase1", p.PrPriceBase1));
        rows.push(addRow("Price Base 2", "PrPriceBase2", p.PrPriceBase2));
        rows.push(row("Common Share", p.PrCommonShare));

        const zone = p.PrPlanningZone;
        const parentZone = parent?.PrPlanningZone;
        const zoneName = zone ? pickName(zone) : null;
        const zoneSameAsParent =
          !!parentZone && !!zone &&
          zoneName === pickName(parentZone) &&
          String(zone.PrDensityRateQty ?? "") === String(parentZone.PrDensityRateQty ?? "") &&
          String(zone.PrCoverageRate ?? "") === String(parentZone.PrCoverageRate ?? "") &&
          String(zone.PrStoreyNoQty ?? "") === String(parentZone.PrStoreyNoQty ?? "");
        const zoneRows = [];
        if (zone && !zoneSameAsParent) {
          zoneRows.push(row("Zone", zoneName));
          zoneRows.push(row("Density Rate", zone.PrDensityRateQty));
          zoneRows.push(row("Coverage Rate", zone.PrCoverageRate));
          zoneRows.push(row("Storey No", zone.PrStoreyNoQty));
        }
        const zoneHtml = zoneRows.filter(Boolean).length
          ? `<div class="mt-1 pt-1 border-t border-border/50"><div class="text-xs font-semibold mb-1">Planning Zone</div>${zoneRows.join("")}</div>`
          : "";

        const subs = p.PrPropertySubproperty ?? [];
        const subRows = [];
        subs.forEach((s) => {
          const kind = pickName(s.PrSubPropertyKind);
          const cat = pickName(s.PrSubPropertyKindCategory);
          const line = [cat, kind].filter(Boolean).join(" — ");
          const extents = [
            s.PrEnclosedExtent != null ? `enc ${s.PrEnclosedExtent}` : null,
            s.PrCoveredExtent != null ? `cov ${s.PrCoveredExtent}` : null,
            s.PrUncoveredExtent != null ? `unc ${s.PrUncoveredExtent}` : null,
          ].filter(Boolean).join(" · ");
          const prices = [
            s.PrPriceBase1 != null ? `P1 ${s.PrPriceBase1}` : null,
            s.PrPriceBase2 != null ? `P2 ${s.PrPriceBase2}` : null,
            s.PrPriceBase3 != null ? `P3 ${s.PrPriceBase3}` : null,
          ].filter(Boolean).join(" · ");
          if (line || extents || prices) {
            subRows.push(`<div class="text-xs"><span class="font-medium">${escapeHtml(line)}</span>${extents ? ` <span class="text-muted-foreground">(${escapeHtml(extents)})</span>` : ""}${prices ? ` <span class="text-muted-foreground">[${escapeHtml(prices)}]</span>` : ""}</div>`);
          }
        });
        const subsHtml = subRows.length
          ? `<div class="mt-1 pt-1 border-t border-border/50"><div class="text-xs font-semibold mb-1">Sub-properties (${subs.length})</div>${subRows.join("")}</div>`
          : "";

        const indent = isUnit ? "ml-3 pl-2 border-l-2 border-border" : "";
        return `<div class="${indent} mt-2 space-y-0.5">
          <div class="text-xs font-semibold ${isUnit ? "text-foreground/80" : "text-foreground"}">${isUnit ? "↳ Unit" : "Parcel"}${headerBits ? `: ${escapeHtml(headerBits)}` : ""}</div>
          ${rows.filter(Boolean).join("")}
          ${zoneHtml}
          ${subsHtml}
        </div>`;
      };

      return groups.map((g) => {
        const parcelHtml = g.parcel ? renderProp(g.parcel, false) : "";
        const unitsHtml = g.units.map((u) => renderProp(u, true, g.parcel)).join("");
        return `<div class="mt-2 pt-2 border-t border-border">${parcelHtml}${unitsHtml}</div>`;
      }).join("");
    };

    const layer = L.layerGroup().addTo(map);
    let cancelled = false;
    const defaultStyle = { color: "#00ffff", weight: 1, fill: true, fillColor: "#00ffff", fillOpacity: 0.05 };
    const selectedStyle = { color: "#facc15", weight: 3, fill: true, fillColor: "#facc15", fillOpacity: 0.25 };
    let selected = null;
    const clearSelection = () => {
      if (selected) {
        selected.forEach((p) => p.setStyle(defaultStyle));
        selected = null;
      }
    };

    const load = async () => {
      if (map.getZoom() < 14) {
        layer.clearLayers();
        return;
      }
      const b = map.getBounds();
      const envelope = {
        xmin: b.getWest(), ymin: b.getSouth(), xmax: b.getEast(), ymax: b.getNorth(),
      };
      const params = new URLSearchParams({
        f: "json",
        geometry: JSON.stringify(envelope),
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "OBJECTID,DIST_CODE,VIL_CODE,QRTR_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,SBPI_ID_NO,SRC_SL_CODE",
        returnGeometry: "true",
        outSR: "4326",
        resultRecordCount: "300",
        orderByFields: "SHAPE.STArea() ASC",
      });
      try {
        const res = await fetch(
          `https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer/0/query?${params}`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        layer.clearLayers();
        clearSelection();
        (data.features || []).forEach((feat) => {
          const rings = (feat.geometry?.rings || []).map((r) => r.map(([lng, lat]) => [lat, lng]));
          if (!rings.length) return;
          const poly = L.polygon(rings, defaultStyle);
          const a = feat.attributes;
          const sbpiId = a.SBPI_ID_NO;

          let popupEl = null;
          poly.on("click", (ev) => {
            L.DomEvent.stopPropagation(ev);
            clearSelection();
            poly.setStyle(selectedStyle);
            selected = [poly];

            if (!popupEl) {
              const div = L.DomUtil.create("div");
              div.style.minWidth = "220px";
              div.style.maxWidth = "320px";
              div.innerHTML = `
                <div class="space-y-0.5">
                  ${a.DIST_CODE ? `<div class="flex justify-between gap-4"><span class="text-muted-foreground">District Code</span><span class="font-medium">${a.DIST_CODE}</span></div>` : ""}
                  ${a.VIL_CODE ? `<div class="flex justify-between gap-4"><span class="text-muted-foreground">Village Code</span><span class="font-medium">${a.VIL_CODE}</span></div>` : ""}
                  ${a.BLCK_CODE ? `<div class="flex justify-between gap-4"><span class="text-muted-foreground">Block</span><span class="font-medium">${a.BLCK_CODE}</span></div>` : ""}
                  ${a.PARCEL_NBR ? `<div class="flex justify-between gap-4"><span class="text-muted-foreground">Parcel No</span><span class="font-medium">${a.PARCEL_NBR}</span></div>` : ""}
                  ${a.SHEET ? `<div class="flex justify-between gap-4"><span class="text-muted-foreground">Sheet</span><span class="font-medium">${a.SHEET}</span></div>` : ""}
                  ${a.PLAN_NBR ? `<div class="flex justify-between gap-4"><span class="text-muted-foreground">Plan No</span><span class="font-medium">${a.PLAN_NBR}</span></div>` : ""}
                  ${sbpiId ? `<div class="flex justify-between gap-4"><span class="text-muted-foreground">SBPI ID</span><span class="font-medium">${sbpiId}</span></div>` : ""}
                </div>
                ${sbpiId ? `<div id="detail-${sbpiId}" class="mt-2 pt-2 border-t border-border text-xs text-muted-foreground">Loading details…</div>` : ""}
              `;
              popupEl = L.popup({ maxWidth: 360, minWidth: 240 }).setContent(div);

              if (sbpiId) {
                const load = async () => {
                  const cacheKey = String(sbpiId);
                  let rawPromise = inflight.get(cacheKey);
                  if (!rawPromise) {
                    rawPromise = getPropertyData({ action: "parcelDetails", sbpiId: cacheKey })
                      .then((r) => r?.raw ?? "")
                      .catch(() => "");
                    inflight.set(cacheKey, rawPromise);
                  }
                  const raw = await rawPromise;
                  detailsCache.set(cacheKey, raw);
                  inflight.delete(cacheKey);
                  const el = div.querySelector(`#detail-${sbpiId}`);
                  if (el) el.innerHTML = buildDetailsHtml(raw) || `<span class="italic">No details</span>`;
                };
                load();
              }
            }

            poly.bindPopup(popupEl).openPopup(ev.latlng);
          });

          poly.addTo(layer);
        });
      } catch { /* ignore network errors */ }
    };

    const onMoveEnd = () => load();
    map.on("moveend", onMoveEnd);
    load();

    return () => {
      cancelled = true;
      map.off("moveend", onMoveEnd);
      layer.remove();
    };
  }, [map]);

  return null;
}

function buildPopup(p) {
  const fmtPrice = (v) => {
    const n = parseFloat(v);
    if (isNaN(n)) return v;
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
  };
  const fmtDate = (v) => {
    if (!v) return "";
    try { return new Date(v).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" }); }
    catch { return v; }
  };
  const row = (label, val) => {
    if (!val) return "";
    return `<div class="flex justify-between gap-3"><span class="text-muted-foreground">${label}</span><span class="font-medium text-right">${val}</span></div>`;
  };
  const isProperty = "declared_price" in p;
  if (isProperty) {
    const extents = [
      p.enclosed_ext ? `Enc: ${p.enclosed_ext}` : null,
      p.covered_ext ? `Cov: ${p.covered_ext}` : null,
      p.uncovered_ext ? `Unc: ${p.uncovered_ext}` : null,
    ].filter(Boolean).join(" · ");
    const subprop = [
      p.main_sbp_cat, p.main_sbp_kind, p.sec_sbp_cat, p.sec_sbp_kind
    ].filter(Boolean).join(", ");
    return `
      <div class="space-y-0.5 text-xs" style="min-width:200px;max-width:300px">
        <div class="font-semibold text-sm mb-2">${p.town_village_name || "Property"}</div>
        ${row("Block", p.block)}
        ${row("Reg No", p.reg_no)}
        ${row("Type", p.fiscal_property_type)}
        ${row("Price", fmtPrice(p.declared_price))}
        ${row("Sale Date", fmtDate(p.sale_acceptance_date))}
        ${row("Share", p.share_numerator)}
        ${extents ? row("Extents (m²)", extents) : ""}
        ${subprop ? row("Property Type", subprop) : ""}
      </div>
    `;
  } else {
    const extents = [
      p.enclosed_ext ? `Enc: ${p.enclosed_ext}` : null,
      p.covered_ext ? `Cov: ${p.covered_ext}` : null,
      p.uncovered_ext ? `Unc: ${p.uncovered_ext}` : null,
    ].filter(Boolean).join(" · ");
    const subprop = [p.main_sbp_category, p.main_sbp_kind].filter(Boolean).join(", ");
    const remark = [p.remark1, p.remark2].filter(Boolean).join("; ");
    return `
      <div class="space-y-0.5 text-xs" style="min-width:200px;max-width:300px">
        <div class="font-semibold text-sm mb-2">${p.town_village_name || "Transaction"}</div>
        ${row("Block", p.block)}
        ${row("Reg No", p.reg_no)}
        ${row("Amount", fmtPrice(p.cos_amount))}
        ${row("Agreement Date", fmtDate(p.cos_agreement_date))}
        ${row("File Year", p.dlo_file_year)}
        ${row("Share", `${p.share_numerator}/${p.share_denominator}`)}
        ${extents ? row("Extents (m²)", extents) : ""}
        ${subprop ? row("Property Type", subprop) : ""}
        ${remark ? row("Remarks", remark) : ""}
      </div>
    `;
  }
}

function useChartData(properties, transactions) {
  return useMemo(() => {
    const byMonth = {};
    properties.forEach((p) => {
      const d = p.sale_acceptance_date;
      if (!d) return;
      const m = d.substring(0, 7);
      if (!byMonth[m]) byMonth[m] = { month: m, sales: 0, totalPrice: 0, contracts: 0 };
      byMonth[m].sales++;
      const price = parseFloat(p.declared_price);
      if (!isNaN(price)) byMonth[m].totalPrice += price;
    });
    transactions.forEach((t) => {
      const d = t.cos_agreement_date;
      if (!d) return;
      const m = d.substring(0, 7);
      if (!byMonth[m]) byMonth[m] = { month: m, sales: 0, totalPrice: 0, contracts: 0 };
      byMonth[m].contracts++;
    });
    return Object.values(byMonth)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((r) => ({
        month: r.month,
        sales: r.sales,
        avgPrice: r.sales > 0 ? Math.round(r.totalPrice / r.sales) : 0,
        contracts: r.contracts,
      }))
      .slice(-24);
  }, [properties, transactions]);
}

function StatsBar({ properties, transactions }) {
  const totalSales = properties.length;
  const totalContracts = transactions.length;
  const prices = properties.map((p) => parseFloat(p.declared_price)).filter((n) => !isNaN(n) && n > 0);
  const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
  const fmtPrice = (v) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  const offPlanCount = transactions.filter((t) => t.remark1?.toLowerCase().includes("off") || t.remark2?.toLowerCase().includes("off")).length;

  return (
    <div className="flex flex-wrap gap-3 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />
        <span className="text-muted-foreground">Sales:</span>
        <span className="font-semibold text-foreground">{totalSales.toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0" />
        <span className="text-muted-foreground">Off-Plan:</span>
        <span className="font-semibold text-foreground">{totalContracts.toLocaleString()}</span>
      </div>
      {avgPrice > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Avg Price:</span>
          <span className="font-semibold text-foreground">{fmtPrice(avgPrice)}</span>
        </div>
      )}
    </div>
  );
}

export default function PropertyMap({ properties, transactions }) {
  const mapRef = useRef(null);
  const [showChart, setShowChart] = useState(false);
  const chartData = useChartData(properties, transactions);

  const fmtPrice = (v) =>
    new Intl.NumberFormat("en-GB", { notation: "compact", style: "currency", currency: "EUR", maximumFractionDigits: 1 }).format(v);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-background">
      <MapContainer
        center={[34.9, 33.1]}
        zoom={10}
        style={{ width: "100%", height: "100%" }}
        zoomControl={true}
        ref={mapRef}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          maxZoom={20}
        />
        <ParcelLayer />

        {/* Property markers (red) */}
        {properties.map((p, i) => {
          const pos = mercatorToLatLng(parseFloat(p.center_x), parseFloat(p.center_y));
          return (
            <Marker key={`prop-${i}`} position={pos} icon={flagIcon}>
              <Popup>
                <div dangerouslySetInnerHTML={{ __html: buildPopup(p) }} />
              </Popup>
            </Marker>
          );
        })}

        {/* Transaction markers (green) */}
        {transactions.map((t, i) => {
          const pos = mercatorToLatLng(parseFloat(t.center_x), parseFloat(t.center_y));
          return (
            <Marker key={`tx-${i}`} position={pos} icon={offPlanIcon}>
              <Popup>
                <div dangerouslySetInnerHTML={{ __html: buildPopup(t) }} />
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Parcel search panel */}
      <ParcelSearch mapRef={mapRef} />

      {/* Bottom info bar */}
      <div className="absolute bottom-0 left-0 right-0 z-[1000] bg-card/90 backdrop-blur-sm border-t border-border px-4 py-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <StatsBar properties={properties} transactions={transactions} />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChart((v) => !v)}
              className="flex items-center gap-1.5 text-xs rounded border border-border bg-secondary px-2 py-1 hover:bg-muted transition-colors text-foreground"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M3 3v18h18" /><path d="m7 16 4-4 4 4 4-8" />
              </svg>
              {showChart ? "Hide" : "Show"} Chart
            </button>
          </div>
        </div>

        {showChart && chartData.length > 0 && (
          <div className="mt-3 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 28% 25%)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(215 20% 65%)" }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "hsl(215 20% 65%)" }} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={fmtPrice} tick={{ fontSize: 10, fill: "hsl(215 20% 65%)" }} />
                <Tooltip
                  contentStyle={{ background: "hsl(217 33% 17%)", border: "1px solid hsl(215 28% 25%)", borderRadius: "6px", fontSize: 11 }}
                  labelStyle={{ color: "hsl(210 40% 98%)" }}
                  itemStyle={{ color: "hsl(215 20% 65%)" }}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: "hsl(215 20% 65%)" }} />
                <Line yAxisId="left" type="monotone" dataKey="sales" stroke="#ef4444" strokeWidth={2} dot={false} name="Sales" />
                <Line yAxisId="left" type="monotone" dataKey="contracts" stroke="#22c55e" strokeWidth={2} dot={false} name="Off-Plan" />
                <Line yAxisId="right" type="monotone" dataKey="avgPrice" stroke="#facc15" strokeWidth={2} dot={false} name="Avg Price (€)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}