// api/ping-env.js
export default function handler(req, res) {
  res.status(200).json({ hasEnv: !!process.env.WORKER_KEY });
}
