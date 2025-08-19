export const runtime = "edge";

export default async function handler() {
  return new Response("pong", { status: 200 });
}
