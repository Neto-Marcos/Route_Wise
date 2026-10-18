import { readFile } from "node:fs/promises";
import path from "node:path";
import catalog from "@/lib/error-pages.json";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const selected = Object.hasOwn(catalog, code) ? code : "404";
  const html = await readFile(path.join(process.cwd(), "public/error-pages", `${selected}.html`), "utf8");
  return new Response(html, {
    status: new URL(request.url).searchParams.get("preview") === "1" ? 200 : /^\d+$/.test(selected) ? Number(selected) : 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}
