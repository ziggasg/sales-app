import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const AMENITY_GROUPS = [
  { label: "🏫 Schools",          categories: "education.school",          radius: 2000 },
  { label: "🏥 Hospital / Clinic", categories: "healthcare.hospital,healthcare.clinic", radius: 5000 },
  { label: "✈️ Airport",           categories: "airport",                   radius: 80000 },
  { label: "🏖️ Beach",             categories: "beach",                     radius: 20000 },
  { label: "🛒 Supermarket",       categories: "commercial.supermarket",    radius: 2000 },
  { label: "☕ Café",              categories: "catering.cafe",             radius: 2000 },
  { label: "🍽️ Restaurant",        categories: "catering.restaurant",       radius: 2000 },
  { label: "💊 Pharmacy",          categories: "healthcare.pharmacy",       radius: 2000 },
  { label: "⛽ Fuel Station",      categories: "service.vehicle.fuel",      radius: 2000 },
  { label: "🏦 Bank / ATM",        categories: "commercial.bank,amenity.atm", radius: 2000 },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { lat, lon } = await req.json();
    if (!lat || !lon) return Response.json({ error: 'lat and lon required' }, { status: 400 });

    const apiKey = Deno.env.get("GEOAPIFY_API_KEY");
    const results = [];

    for (const group of AMENITY_GROUPS) {
      const url = new URL("https://api.geoapify.com/v2/places");
      url.searchParams.set("categories", group.categories);
      url.searchParams.set("filter", `circle:${lon},${lat},${group.radius}`);
      url.searchParams.set("bias", `proximity:${lon},${lat}`);
      url.searchParams.set("limit", "3");
      url.searchParams.set("apiKey", apiKey);

      const res = await fetch(url.toString());
      const data = await res.json();
      const items = (data.features || [])
        .map((f) => ({
          name: f.properties.name || f.properties.brand || null,
          dist: f.properties.distance ?? null,
        }))
        .filter((i) => i.name && i.dist !== null);

      if (items.length > 0) results.push({ label: group.label, items });
    }

    return Response.json({ results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});