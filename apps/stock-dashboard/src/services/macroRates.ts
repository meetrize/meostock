/**
 * 宏观利率：/api/macro/rates（NY Fed + 美国财政部）
 */

export type MacroRateSeries = {
  id: string;
  name: string;
  value: number | null;
  unit?: string;
  as_of?: string | null;
  source?: string;
  change?: number | null;
  note?: string | null;
};

export type MacroRatesPayload = {
  ok: boolean;
  as_of?: string | null;
  fetched_at?: number;
  cache_ttl_sec?: number;
  fed?: {
    target_from?: number | null;
    target_to?: number | null;
    target_mid?: number | null;
    effr?: number | null;
    date?: string | null;
    source?: string | null;
  };
  curve?: Record<string, number | string | null | undefined>;
  policy_expectation?: {
    provider?: string;
    url?: string;
    note?: string;
    proxy_short_vs_target_upper_bp?: number | null;
    proxy_note?: string;
  };
  series?: MacroRateSeries[];
  errors?: string[];
  error?: string;
};

export async function fetchMacroRates(opts?: {
  force?: boolean;
}): Promise<MacroRatesPayload> {
  const qs = new URLSearchParams();
  if (opts?.force) qs.set('force', '1');
  const url = qs.toString() ? `/api/macro/rates?${qs}` : '/api/macro/rates';
  try {
    const res = await fetch(url);
    const data = (await res.json().catch(() => ({}))) as MacroRatesPayload;
    if (!res.ok && !data.series) {
      return {
        ok: false,
        error: data.error || `macro rates ${res.status}`,
        series: [],
      };
    }
    return data;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      series: [],
    };
  }
}
