import { connection } from "next/server";
import { availableModels } from "@/lib/providers";

/** The models this server is configured for, for the picker. At request time: the keys are runtime config. */
export async function GET() {
  await connection();
  return Response.json(availableModels(), { headers: { "cache-control": "no-store" } });
}
