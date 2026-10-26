export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const token = typeof req.query.k === "string" ? req.query.k : "";
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return res.status(404).json({ error: "Not found" });
  try {
    const target = "https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/r2-verified-aux-copy-once?k=" + encodeURIComponent(token);
    const upstream = await fetch(target, { method: "GET", cache: "no-store" });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(body);
  } catch (error) {
    return res.status(502).json({ error: "Temporary upstream request failed" });
  }
}
