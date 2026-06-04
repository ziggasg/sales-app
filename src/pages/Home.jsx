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
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-destructive text-sm">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90"
          >
            Try again
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