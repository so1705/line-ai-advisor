// /api/test-firestore.js
import { db } from "../../lib/firestore.js";

export default async function handler(req, res) {
  try {
    const ref = db.collection("logs").doc("ping");
    await ref.set({ at: new Date().toISOString() }, { merge: true });
    const snap = await ref.get();
    return res.status(200).json({ ok: true, data: snap.data() });
  } catch (e) {
    console.error("Firestore test error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
