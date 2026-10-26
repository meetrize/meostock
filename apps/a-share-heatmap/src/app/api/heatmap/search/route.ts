import { NextRequest, NextResponse } from "next/server";

import { searchStocks } from "@/lib/market-heatmap";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsedLimit = limitParam ? Number(limitParam) : 12;
  const limit = Number.isFinite(parsedLimit) ? Math.min(20, Math.max(1, Math.floor(parsedLimit))) : 12;

  if (!query) {
    return NextResponse.json({ query, items: [] });
  }

  const items = searchStocks(query, limit);
  const response = NextResponse.json({
    query,
    items,
  });
  response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");

  return response;
}
