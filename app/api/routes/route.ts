import type { NextRequest } from "next/server";
import { GET as catchAllGet, POST as catchAllPost } from "../[...path]/route";

const routesContext = { params: Promise.resolve({ path: ["routes"] }) };

export function GET(request: NextRequest) {
  return catchAllGet(request, routesContext);
}

export function POST(request: NextRequest) {
  return catchAllPost(request, routesContext);
}
