import { useState, useEffect, lazy, Suspense } from "react";
import { getPropertyData } from "@/functions/getPropertyData";
import { Loader2 } from "lucide-react";

const PropertyMap = lazy(() => import("@/components/map/PropertyMap"));

export default function Home() {
  const [properties, setProperties] = useState(null);
  const [transactions, setTransactions] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [propsRes, txRes] = await Promise.all([
          getPropertyData({ action: "properties" }),
          getPropertyData({ action: "transactions" }),
        ]);
        setProperties(propsRes.data?.data || []);
        setTransactions(txRes.data?.data || []);
      } catch (err) {
        setError(err.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground text-sm">Loading property sales…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, #f5f0ff 0%, #ede8f5 100%)",
        fontFamily: "Roboto, sans-serif", padding: 24,
      }}>
        <div style={{
          background: "#fff", borderRadius: 24, padding: "40px 32px",
          boxShadow: "0 8px 32px rgba(103,80,164,0.12)",
          maxWidth: 360, width: "100%", textAlign: "center",
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔧</div>
          <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: "#1a1625" }}>
            Under Maintenance
          </h2>
          <p style={{ margin: "0 0 24px", fontSize: 14, color: "#7c6fa0", lineHeight: 1.6 }}>
            The property data service is temporarily unavailable. Our team is working to restore it. Please check back shortly.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#6750a4", color: "#fff", border: "none",
              borderRadius: 24, padding: "12px 32px",
              fontSize: 14, fontWeight: 500, cursor: "pointer",
              boxShadow: "0 2px 8px rgba(103,80,164,0.3)",
            }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="h-screen w-screen bg-background" />}>
      <PropertyMap properties={properties || []} transactions={transactions || []} />
    </Suspense>
  );
}