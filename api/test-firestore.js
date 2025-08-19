// /api/test-firestore.js
import { db } from "@/lib/firestore";

export default async function handler(req, res) {
  try {
    // 書き込み
    const pingRef = db.collection("logs").doc("ping");
    await pingRef.set({ at: new Date().toISOString() }, { merge: true });

    // 読み取り
    const snap = await pingRef.get();
    return res.status(200).json({ ok: true, data: snap.data() });
  } catch (e) {
    console.error("Firestore test error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
