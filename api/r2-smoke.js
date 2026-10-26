// Temporary migration validation route. Remove after the one-off R2 smoke test.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const response = await fetch("https://selnsjtumkxjrtnqofqx.supabase.co/functions/v1/r2-storage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": "sb_publishable_a_yXSwHeOJNSw39UZsh4GQ_7SepV9i0",
      },
      body: JSON.stringify({ action: "smoke-test" }),
    });
    const payload = await response.json().catch(() => ({}));
    return res.status(200).json({ edgeStatus: response.status, result: payload });
  } catch {
    return res.status(502).json({ error: "Could not reach the R2 smoke test endpoint" });
  }
}
