// /lib/firestore.js  ← 新規 or 置き換え
const admin = require("firebase-admin");

// ── env（VercelのProductionに入っている想定）
const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
let privateKey = process.env.FIREBASE_PRIVATE_KEY;

// \n を復元
if (privateKey && privateKey.includes("\\n")) {
  privateKey = privateKey.replace(/\\n/g, "\n");
}

// 多重初期化ガード
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

const db = admin.firestore();

async function getUserState(userId) {
  const snap = await db.collection("users").doc(userId).get();
  return snap.exists ? snap.data() : { aiMode: "off" };
}

async function setUserState(userId, patch) {
  await db
    .collection("users")
    .doc(userId)
    .set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
}

module.exports = { db, getUserState, setUserState };
