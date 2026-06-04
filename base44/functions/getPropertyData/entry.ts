Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { action, sbpiId } = body;

    if (action === 'properties') {
      const res = await fetch("http://kybnxfh.cluster051.hosting.ovh.net/getProperties.php");
      if (!res.ok) throw new Error("Failed to fetch properties");
      const data = await res.json();
      const filtered = data.filter((p) => p.center_x && p.center_y);
      return Response.json({ data: filtered });
    }

    if (action === 'transactions') {
      const res = await fetch("http://kybnxfh.cluster051.hosting.ovh.net/getTransactions.php");
      if (!res.ok) throw new Error("Failed to fetch transactions");
      const data = await res.json();
      const filtered = data.filter((t) => t.center_x && t.center_y);
      return Response.json({ data: filtered });
    }

    if (action === 'parcelDetails' && sbpiId) {
      const res = await fetch(
        `http://kybnxfh.cluster051.hosting.ovh.net/maptest.php?sbpiID=${encodeURIComponent(String(sbpiId))}`
      );
      if (!res.ok) throw new Error("Failed to fetch parcel details");
      const text = await res.text();
      return Response.json({ raw: text });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});