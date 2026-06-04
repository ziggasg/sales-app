// Builds HTML for parcel detail popups
const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const pickName = (o) => {
  if (!o || typeof o !== "object") return null;
  const v = o.NameEn ?? o.PrNameEn ?? o.Name;
  return typeof v === "string" ? v.trim() : null;
};

const row = (label, val) => {
  if (val == null || val === "") return "";
  return `<div class="flex justify-between gap-4"><span class="text-muted-foreground">${escapeHtml(label)}</span><span class="font-medium text-right">${escapeHtml(String(val))}</span></div>`;
};

const fmtEur = (v) => {
  const n = parseFloat(v);
  if (isNaN(n)) return escapeHtml(String(v));
  return "€" + n.toLocaleString("en-CY", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const valuationCard = (p1, p2, p3) => {
  const items = [
    p2 != null ? { year: "2021", label: "Valuation",     val: p2 } : null,
    p1 != null ? { year: "2018", label: "Land Register", val: p1 } : null,
    p3 != null ? { year: "1980", label: "Valuation",     val: p3 } : null,
  ].filter(Boolean);
  if (!items.length) return "";
  const cols = items.map(({ year, label, val }) =>
    `<div style="flex:1;min-width:0;background:#f5f0ff;border-radius:10px;padding:8px 10px;text-align:center;">
      <div style="font-size:10px;color:#9c8fba;margin-bottom:2px;">${escapeHtml(year)} ${escapeHtml(label)}</div>
      <div style="font-size:14px;font-weight:700;color:#3d1f8a;">${fmtEur(val)}</div>
    </div>`
  ).join("");
  return `<div style="margin-top:12px;margin-bottom:4px;">
    <div style="font-size:10px;font-weight:600;color:#7c6fa0;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Valuations</div>
    <div style="display:flex;gap:6px;">${cols}</div>
  </div>`;
};

function renderProp(p, isUnit, parent) {
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
  const valCard = valuationCard(p.PrPriceBase1, p.PrPriceBase2, p.PrPriceBase3);
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

  const subs = (p.PrPropertySubproperty) ?? [];
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
      s.PrPriceBase1 != null ? `2018: ${s.PrPriceBase1}` : null,
      s.PrPriceBase2 != null ? `2021: ${s.PrPriceBase2}` : null,
      s.PrPriceBase3 != null ? `1980: ${s.PrPriceBase3}` : null,
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
    ${valCard}
    ${zoneHtml}
    ${subsHtml}
  </div>`;
}

export function buildDetailsHtml(raw) {
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

  return groups.map((g) => {
    const parcelHtml = g.parcel ? renderProp(g.parcel, false) : "";
    const unitsHtml = g.units.map((u) => renderProp(u, true, g.parcel)).join("");
    return `<div class="mt-2 pt-2 border-t border-border">${parcelHtml}${unitsHtml}</div>`;
  }).join("");
}