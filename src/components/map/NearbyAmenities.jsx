import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getNearbyAmenities } from "@/functions/getNearbyAmenities";

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export default function NearbyAmenities({ lat, lon }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!lat || !lon) return;
    let cancelled = false;
    setLoading(true);
    setResults([]);
    setError(null);

    getNearbyAmenities({ lat, lon })
      .then((res) => {
        if (!cancelled) setResults(res.data?.results || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [lat, lon]);

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{
        fontWeight: 700, fontSize: 14, color: "#1a1625",
        marginBottom: 12, paddingBottom: 8,
        borderBottom: "2px solid #ede8f5",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        Nearby Amenities
        {loading && <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />}
      </div>

      {error && (
        <p style={{ color: "#ef4444", fontSize: 13 }}>Failed to load amenities.</p>
      )}

      {!loading && !error && results.length === 0 && (
        <p style={{ color: "#9c8fba", fontSize: 13, fontStyle: "italic" }}>
          No named amenities found nearby.
        </p>
      )}

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