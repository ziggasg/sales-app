import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const AMENITY_GROUPS = [
  {
    label: "🏫 Schools",
    query: (lat, lon, r) => `node["amenity"~"school|primary_school|secondary_school"](around:${r},${lat},${lon});way["amenity"~"school|primary_school|secondary_school"](around:${r},${lat},${lon});`,
  },
  {
    label: "🏥 Hospital / Clinic",
    query: (lat, lon, r) => `node["amenity"~"hospital|clinic|doctors"](around:${r},${lat},${lon});way["amenity"~"hospital|clinic|doctors"](around:${r},${lat},${lon});`,
  },
  {
    label: "✈️ Airport",
    query: (lat, lon, r) => `node["aeroway"="aerodrome"](around:${r},${lat},${lon});way["aeroway"="aerodrome"](around:${r},${lat},${lon});`,
    radius: 80000,
  },
  {
    label: "🏖️ Beach",
    query: (lat, lon, r) => `node["natural"="beach"](around:${r},${lat},${lon});way["natural"="beach"](around:${r},${lat},${lon});`,
    radius: 20000,
  },
  {
    label: "🛒 Supermarket",
    query: (lat, lon, r) => `node["shop"~"supermarket|grocery"](around:${r},${lat},${lon});way["shop"~"supermarket|grocery"](around:${r},${lat},${lon});`,
  },
  {
    label: "☕ Café / Kiosk",
    query: (lat, lon, r) => `node["amenity"~"cafe|kiosk|vending_machine"](around:${r},${lat},${lon});`,
  },
  {
    label: "🍽️ Restaurant",
    query: (lat, lon, r) => `node["amenity"~"restaurant|fast_food|food_court"](around:${r},${lat},${lon});`,
  },
  {
    label: "💊 Pharmacy",
    query: (lat, lon, r) => `node["amenity"="pharmacy"](around:${r},${lat},${lon});`,
  },
  {
    label: "⛽ Fuel Station",
    query: (lat, lon, r) => `node["amenity"="fuel"](around:${r},${lat},${lon});`,
  },
  {
    label: "🏦 Bank / ATM",
    query: (lat, lon, r) => `node["amenity"~"bank|atm"](around:${r},${lat},${lon});`,
  },
];

const DEFAULT_RADIUS = 2000; // metres

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

async function fetchGroup(group, lat, lon) {
  const radius = group.radius || DEFAULT_RADIUS;
  const overpassQuery = `[out:json][timeout:10];(${group.query(lat, lon, radius)});out center 5;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: overpassQuery,
  });
  const data = await res.json();
  const items = (data.elements || []).map((el) => {
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    const dist = (elLat && elLon) ? haversine(lat, lon, elLat, elLon) : null;
    const name = el.tags?.name || el.tags?.["name:en"] || el.tags?.brand || "(unnamed)";
    return { name, dist };
  }).filter((i) => i.dist !== null).sort((a, b) => a.dist - b.dist).slice(0, 3);
  return { label: group.label, items };
}

export default function NearbyAmenities({ lat, lon }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!lat || !lon) return;
    setLoading(true);
    setResults([]);

    Promise.allSettled(AMENITY_GROUPS.map((g) => fetchGroup(g, lat, lon)))
      .then((settled) => {
        const out = settled
          .filter((s) => s.status === "fulfilled")
          .map((s) => s.value)
          .filter((g) => g.items.length > 0);
        setResults(out);
      })
      .finally(() => setLoading(false));
  }, [lat, lon]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#7c6fa0", fontSize: 13, marginTop: 16 }}>
        <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
        Loading nearby amenities…
      </div>
    );
  }

  if (!results.length) {
    return (
      <p style={{ color: "#9c8fba", fontSize: 13, fontStyle: "italic", marginTop: 16 }}>
        No nearby amenities found within 2 km.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{
        fontWeight: 700, fontSize: 14, color: "#1a1625",
        marginBottom: 12, paddingBottom: 8,
        borderBottom: "2px solid #ede8f5",
      }}>
        Nearby Amenities
      </div>
      {results.map((group) => (
        <div key={group.label} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: "#6750a4", marginBottom: 6 }}>
            {group.label}
          </div>
          {group.items.map((item, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "6px 0", borderBottom: "1px solid #f5f0ff", gap: 8,
            }}>
              <span style={{ fontSize: 13, color: "#1a1625", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.name}
              </span>
              <span style={{
                fontSize: 12, color: "#fff", background: "#6750a4",
                borderRadius: 20, padding: "2px 10px", flexShrink: 0, fontWeight: 500,
              }}>
                {fmtDist(item.dist)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}