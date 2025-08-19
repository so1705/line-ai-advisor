// /lib/firestore.js
import admin from "firebase-admin";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
let privateKey = process.env.FIREBASE_PRIVATE_KEY;

// Vercelの環境変数は \n エスケープで渡すため復元
if (privateKey?.includes("\\n")) {
  privateKey = privateKey.replace(/\\n/g, "\n");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

export const db = admin.firestore();

// 最小ユーティリティ
export async function getUserState(userId) {
  const snap = await db.collection("users").doc(userId).get();
  return snap.exists ? snap.data() : null;
}

export async function setUserState(userId, patch) {
  const ref = db.collection("users").doc(userId);
  await ref.set(
    { ...patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

export async function getGlobalSettings() {
  const doc = await db.collection("settings").doc("global").get();
  return doc.exists ? doc.data() : {};
}
