// node_modules/stock-sdk/dist/chunk-UBIQBXQ7.js
var s = class extends Error {
  constructor(r) {
    super(r.message), this.name = "SdkError", this.code = r.code, this.provider = r.provider, this.url = r.url, this.status = r.status, this.details = r.details, r.cause !== void 0 && (this.cause = r.cause);
  }
};
var u = class extends s {
  constructor(t, o, n, i) {
    let f3 = o ? ` ${o}` : "", T3 = n ? `, url: ${n}` : "", m2 = i ? `, provider: ${i}` : "";
    super({ code: t === 429 ? "RATE_LIMITED" : "HTTP_ERROR", message: `HTTP error! status: ${t}${f3}${T3}${m2}`, status: t, url: n, provider: i, details: { statusText: o } });
    this.status = t;
    this.name = "HttpError", this.statusText = o;
  }
};
var a = class extends s {
  constructor(r, t, o) {
    super({ code: "UPSTREAM_EMPTY", message: r, provider: t, url: o }), this.name = "UpstreamEmptyError";
  }
};
var E = class extends s {
  constructor(r, t, o) {
    super({ code: "NOT_FOUND", message: r, provider: t, url: o }), this.name = "NotFoundError";
  }
};
var c = class extends s {
  constructor(r, t) {
    super({ code: "INVALID_ARGUMENT", message: r, details: t }), this.name = "InvalidArgumentError";
  }
};
var R = class extends s {
  constructor(r, t) {
    super({ code: "INVALID_SYMBOL", message: `Invalid symbol: ${r}`, provider: t, details: { symbol: r } }), this.name = "InvalidSymbolError";
  }
};
var l = class extends s {
  constructor(r, t, o, n) {
    super({ code: "UPSTREAM_ERROR", message: r, provider: t, url: o, details: n }), this.name = "UpstreamError";
  }
};
var p = class extends s {
  constructor(r = "Request aborted", t, o) {
    super({ code: "ABORTED", message: r, provider: t, url: o }), this.name = "AbortedError";
  }
};
function d(e2, r) {
  let t = e2;
  return !t.sdkCode && r.sdkCode && (t.sdkCode = r.sdkCode), !t.provider && r.provider && (t.provider = r.provider), !t.url && r.url && (t.url = r.url), t.status === void 0 && r.status !== void 0 && (t.status = r.status), !t.details && r.details && (t.details = r.details), t;
}
function v(e2, r) {
  return d(e2, { provider: r.provider, url: r.url });
}
function O(e2) {
  if (e2 instanceof s || e2 instanceof u) return e2.code;
  if (e2 instanceof DOMException && e2.name === "AbortError") return "TIMEOUT";
  if (e2 instanceof TypeError) return e2.sdkCode ?? "NETWORK_ERROR";
  if (e2 instanceof Error) return e2.sdkCode;
}
function g(e2, r = {}) {
  return e2 instanceof s ? v(e2, r) : e2 instanceof DOMException && e2.name === "AbortError" ? d(e2, { sdkCode: "TIMEOUT", provider: r.provider, url: r.url, details: r.timeout ? { timeout: r.timeout } : void 0 }) : e2 instanceof TypeError ? d(e2, { sdkCode: "NETWORK_ERROR", provider: r.provider, url: r.url }) : e2 instanceof Error ? d(e2, { sdkCode: "NETWORK_ERROR", provider: r.provider, url: r.url }) : new s({ code: "NETWORK_ERROR", message: "Unknown request error", provider: r.provider, url: r.url, cause: e2 });
}

// node_modules/stock-sdk/dist/chunk-OPCBE3NR.js
function E2(i) {
  return typeof i == "number" ? i : typeof i == "string" && i.trim() !== "" ? Number(i) : NaN;
}
function G(i) {
  let t = i.slice(), T3 = { where(n) {
    return t = t.filter(n), T3;
  }, sortBy(n, r = "desc") {
    if (r !== "asc" && r !== "desc") throw new c(`sortBy(direction): \u4EC5\u63A5\u53D7 'asc' / 'desc'\uFF0C\u5F97\u5230 ${String(r)}`, { direction: r });
    let c2 = r === "asc" ? 1 : -1;
    return t.sort((k3, h3) => {
      let s3 = E2(n(k3)), u3 = E2(n(h3)), a3 = Number.isFinite(s3), l4 = Number.isFinite(u3);
      return !a3 && !l4 ? 0 : a3 ? l4 ? (s3 - u3) * c2 : -1 : 1;
    }), T3;
  }, top(n) {
    if (!Number.isInteger(n) || n < 0) throw new c(`top(n): n must be a non-negative integer, got ${n}`, { n });
    return t.slice(0, n);
  }, toArray() {
    return t.slice();
  } };
  return T3;
}
function M(i) {
  return i?.close ?? null;
}
function F(i, t) {
  if (!Number.isFinite(t) || t < 0 || t >= 1) throw new c(`${i} \u5FC5\u987B\u5728 [0, 1) \u5185\uFF08\u5982 0.0003 \u8868\u793A\u4E07\u5206\u4E4B\u4E09\uFF09\uFF0C\u5F97\u5230 ${t}`, { [i]: t });
}
function J(i) {
  let { klines: t, strategy: T3, initialCapital: n = 1e5, fee: r = 0, positionSize: c2 = 1, getClose: k3 = M, getDate: h3 } = i;
  if (!Number.isFinite(n) || n <= 0) throw new c(`initialCapital \u5FC5\u987B\u4E3A\u6B63\u6709\u9650\u6570\uFF0C\u5F97\u5230 ${n}`, { initialCapital: n });
  let s3, u3;
  if (r == null) s3 = u3 = 0;
  else if (typeof r == "number") s3 = u3 = r, F("fee", r);
  else if (typeof r == "object") s3 = r.buy, u3 = r.sell, F("fee.buy", s3), F("fee.sell", u3);
  else throw new c(`fee \u5FC5\u987B\u662F\u6570\u5B57\u6216 { buy, sell } \u5BF9\u8C61\uFF0C\u5F97\u5230 ${String(r)}`, { fee: r });
  if (!Number.isFinite(c2) || c2 <= 0 || c2 > 1) throw new c(`positionSize \u5FC5\u987B\u5728 (0, 1] \u5185\uFF0C\u5F97\u5230 ${c2}`, { positionSize: c2 });
  let a3 = n, l4 = 0, C = 0, D4 = -1, y3 = 0, N4 = -1, S2 = 0, $2 = 0, w = null, p3 = [], f3 = [], I2 = (e2) => {
    if (!(!h3 || e2 < 0 || t[e2] == null)) return h3(t[e2]) ?? void 0;
  }, O2 = (e2, b3, g2) => {
    let o = (b3 / C * (1 - s3) * (1 - u3) - 1) * 100, d6 = { entryIndex: D4, exitIndex: e2, entryPrice: C, exitPrice: b3, returnPercent: o, forced: g2 }, P3 = I2(D4);
    P3 !== void 0 && (d6.entryDate = P3);
    let B3 = I2(e2);
    B3 !== void 0 && (d6.exitDate = B3), p3.push(d6);
  };
  for (let e2 = 0; e2 < t.length; e2++) {
    let b3 = t[e2] == null, g2 = b3 ? null : k3(t[e2]), o = g2 != null && Number.isFinite(g2) && g2 > 0 ? g2 : null, d6 = b3 ? "hold" : T3(t[e2], e2, t);
    if (o != null) {
      $2++, y3 = o, N4 = e2, S2 === 0 && (S2 = o);
      let v4 = d6 !== "hold" ? d6 : w;
      if (w = null, v4 === "buy" && l4 === 0) {
        let A4 = a3 * c2;
        l4 = A4 * (1 - s3) / o, C = o, D4 = e2, a3 -= A4;
      } else v4 === "sell" && l4 > 0 && (a3 += l4 * o * (1 - u3), O2(e2, o, false), l4 = 0);
    } else d6 !== "hold" && (w = d6);
    let B3 = a3 + l4 * (o ?? y3);
    f3.push(B3);
  }
  if (l4 > 0 && y3 > 0) {
    a3 += l4 * y3 * (1 - u3), O2(N4, y3, w !== "sell");
    for (let e2 = Math.max(N4, 0); e2 < f3.length; e2++) f3[e2] = a3;
  }
  let q4 = f3.length ? f3[f3.length - 1] : n, z4 = (q4 / n - 1) * 100, H4 = p3.filter((e2) => e2.returnPercent > 0).length, j3 = p3.length ? H4 / p3.length * 100 : 0, V3 = S2 > 0 ? (y3 / S2 - 1) * 100 : 0, x = n, R4 = 0;
  for (let e2 of f3) {
    e2 > x && (x = e2);
    let b3 = (x - e2) / x * 100;
    b3 > R4 && (R4 = b3);
  }
  return { initialCapital: n, finalEquity: q4, totalReturn: z4, winRate: j3, maxDrawdown: R4, buyHoldReturn: V3, validBars: $2, tradeCount: p3.length, trades: p3, equityCurve: f3 };
}

// node_modules/stock-sdk/dist/chunk-SMCYQ6NL.js
var a2 = class {
  constructor(e2 = {}) {
    this.cache = /* @__PURE__ */ new Map();
    this.inflight = /* @__PURE__ */ new Map();
    this.defaultTTL = e2.defaultTTL ?? 0, this.maxSize = e2.maxSize ?? 1e3;
  }
  get(e2) {
    let t = this.cache.get(e2);
    if (t) {
      if (t.expireAt > 0 && Date.now() > t.expireAt) {
        this.cache.delete(e2);
        return;
      }
      return t.lastAccess = Date.now(), t.value;
    }
  }
  set(e2, t, i) {
    this.cache.size >= this.maxSize && !this.cache.has(e2) && this.evictLRU();
    let r = i ?? this.defaultTTL, c2 = Date.now();
    this.cache.set(e2, { value: t, expireAt: r > 0 ? c2 + r : 0, lastAccess: c2 });
  }
  has(e2) {
    return this.get(e2) !== void 0;
  }
  delete(e2) {
    return this.cache.delete(e2);
  }
  clear() {
    this.cache.clear(), this.inflight.clear();
  }
  get size() {
    return this.cache.size;
  }
  cleanup() {
    let e2 = Date.now(), t = 0;
    for (let [i, r] of this.cache) r.expireAt > 0 && e2 > r.expireAt && (this.cache.delete(i), t++);
    return t;
  }
  evictLRU() {
    let e2 = null, t = 1 / 0;
    for (let [i, r] of this.cache) r.lastAccess < t && (t = r.lastAccess, e2 = i);
    e2 !== null && this.cache.delete(e2);
  }
  matchesOptions(e2) {
    return (e2.defaultTTL ?? this.defaultTTL) === this.defaultTTL && (e2.maxSize ?? this.maxSize) === this.maxSize;
  }
  configure(e2) {
    if (e2.defaultTTL !== void 0 && (this.defaultTTL = e2.defaultTTL), e2.maxSize !== void 0) {
      this.maxSize = e2.maxSize;
      let t = this.cache.size;
      for (; this.cache.size > this.maxSize && t-- > 0; ) this.evictLRU();
    }
  }
  async getOrFetch(e2, t, i) {
    let r = this.get(e2);
    if (r !== void 0) return r;
    let c2 = this.inflight.get(e2);
    if (c2) return c2;
    let o = t().then((u3) => (this.set(e2, u3, i), u3)).finally(() => {
      this.inflight.delete(e2);
    });
    return this.inflight.set(e2, o), o;
  }
};
var s2 = /* @__PURE__ */ new Map();
var l2 = /* @__PURE__ */ new Set();
function f(n, e2) {
  let t = s2.get(n);
  if (t) return e2 !== void 0 && !t.matchesOptions(e2) && !l2.has(n) && (l2.add(n), console.warn(`[stock-sdk] getSharedCache("${n}") \u5DF2\u5B58\u5728\uFF0C\u672C\u6B21\u4F20\u5165\u7684 options \u4E0D\u751F\u6548\uFF1B\u5982\u9700\u8C03\u6574\u8BF7\u7528 configureSharedCache("${n}", options)`)), t;
  let i = new a2(e2);
  return s2.set(n, i), i;
}
function d2(n, e2) {
  let t = s2.get(n);
  return t ? (t.configure(e2), true) : false;
}
var h = /* @__PURE__ */ new WeakMap();
function T(n, e2, t) {
  let i = h.get(n);
  i || (i = /* @__PURE__ */ new Map(), h.set(n, i));
  let r = i.get(e2);
  return r || (r = new a2(t), i.set(e2, r)), r;
}
function m(n) {
  h.delete(n);
}
function p2(...n) {
  return n.map((e2) => e2 == null ? "\u2205" : String(e2)).join(":");
}

// node_modules/stock-sdk/dist/chunk-VKXPLWPL.js
var d3 = class {
  constructor(e2) {
    this.cache = new a2(e2);
  }
  get(e2) {
    return this.cache.get(e2);
  }
  set(e2, r, a3) {
    this.cache.set(e2, r, a3);
  }
  delete(e2) {
    this.cache.delete(e2);
  }
  clear() {
    this.cache.clear();
  }
};
var l3 = /* @__PURE__ */ new WeakMap();
async function f2(n, e2, r, a3) {
  let c2 = await n.get(e2);
  if (c2 !== void 0) return c2;
  let t = l3.get(n);
  t || (t = /* @__PURE__ */ new Map(), l3.set(n, t));
  let o = t.get(e2);
  if (o) return o;
  let s3 = (async () => {
    let i = await r();
    return i !== void 0 && await n.set(e2, i, a3), i;
  })().finally(() => {
    t.delete(e2);
  });
  return t.set(e2, s3), s3;
}

// node_modules/stock-sdk/dist/chunk-W625VPPB.js
function d4(e2, t = 3) {
  let r = Math.pow(10, t);
  return Math.round(e2 * r) / r;
}
var A = class {
  constructor(t, r) {
    this.sum = 0;
    this.comp = 0;
    this.count = 0;
    this.data = t, this.period = r;
  }
  advance(t) {
    let r = this.data[t];
    if (r !== null && (this.add(r), this.count++), t >= this.period) {
      let u3 = this.data[t - this.period];
      u3 !== null && (this.add(-u3), this.count--);
    }
    Number.isFinite(this.sum) || this.refill(t);
  }
  get value() {
    return this.sum;
  }
  get nonNullCount() {
    return this.count;
  }
  add(t) {
    let r = t - this.comp, u3 = this.sum + r;
    this.comp = u3 - this.sum - r, this.sum = u3;
  }
  refill(t) {
    this.sum = 0, this.comp = 0;
    let r = Math.max(0, t - this.period + 1);
    for (let u3 = r; u3 <= t; u3++) {
      let c2 = this.data[u3];
      c2 !== null && this.add(c2);
    }
  }
};
function j(e2, t, r) {
  let u3 = new Array(e2.length), c2 = new A(e2, t);
  for (let s3 = 0; s3 < e2.length; s3++) c2.advance(s3), u3[s3] = s3 >= t - 1 && c2.nonNullCount === t ? d4(c2.value / t, r) : null;
  return u3;
}
function D(e2, t, r) {
  let u3 = [], c2 = 2 / (t + 1), s3 = null, n = false;
  for (let o = 0; o < e2.length; o++) {
    if (o < t - 1) {
      u3.push(null);
      continue;
    }
    if (!n) {
      let i = 0, a3 = 0;
      for (let m2 = o - t + 1; m2 <= o; m2++) e2[m2] !== null && (i += e2[m2], a3++);
      a3 === t && (s3 = i / t, n = true), u3.push(s3 !== null ? d4(s3, r) : null);
      continue;
    }
    let l4 = e2[o];
    l4 === null ? u3.push(s3 !== null ? d4(s3, r) : null) : (s3 = c2 * l4 + (1 - c2) * s3, u3.push(d4(s3, r)));
  }
  return u3;
}
function le(e2, t, r) {
  let u3 = [], c2 = Array.from({ length: t }, (n, o) => o + 1), s3 = c2.reduce((n, o) => n + o, 0);
  for (let n = 0; n < e2.length; n++) {
    if (n < t - 1) {
      u3.push(null);
      continue;
    }
    let o = 0, l4 = true;
    for (let i = 0; i < t; i++) {
      let a3 = e2[n - t + 1 + i];
      if (a3 === null) {
        l4 = false;
        break;
      }
      o += a3 * c2[i];
    }
    u3.push(l4 ? d4(o / s3, r) : null);
  }
  return u3;
}
function J2(e2, t = {}) {
  let { periods: r = [5, 10, 20, 30, 60, 120, 250], type: u3 = "sma", decimals: c2 } = t, s3 = u3 === "ema" ? D : u3 === "wma" ? le : j, n = {};
  for (let o of r) n[`ma${o}`] = s3(e2, o, c2);
  return e2.map((o, l4) => {
    let i = {};
    for (let a3 of r) i[`ma${a3}`] = n[`ma${a3}`][l4];
    return i;
  });
}
function F2(e2, t = {}) {
  let { short: r = 12, long: u3 = 26, signal: c2 = 9, decimals: s3 } = t, n = D(e2, r, s3), o = D(e2, u3, s3), l4 = e2.map((a3, m2) => n[m2] === null || o[m2] === null ? null : n[m2] - o[m2]), i = D(l4, c2, s3);
  return e2.map((a3, m2) => ({ dif: l4[m2] !== null ? d4(l4[m2], s3) : null, dea: i[m2], macd: l4[m2] !== null && i[m2] !== null ? d4((l4[m2] - i[m2]) * 2, s3) : null }));
}
function ae(e2, t, r) {
  let u3 = new Array(e2.length), c2 = e2.map((o) => o === null ? null : o * o), s3 = new A(e2, t), n = new A(c2, t);
  for (let o = 0; o < e2.length; o++) {
    s3.advance(o), n.advance(o);
    let l4 = r[o];
    if (o < t - 1 || l4 === null) {
      u3[o] = null;
      continue;
    }
    if (s3.nonNullCount !== t) {
      u3[o] = null;
      continue;
    }
    let i = n.value - 2 * l4 * s3.value + t * l4 * l4;
    u3[o] = Math.sqrt(Math.max(0, i) / t);
  }
  return u3;
}
function q(e2, t = {}) {
  let { period: r = 20, stdDev: u3 = 2, decimals: c2 } = t, s3 = j(e2, r, c2), n = ae(e2, r, s3);
  return e2.map((o, l4) => {
    if (s3[l4] === null || n[l4] === null) return { mid: null, upper: null, lower: null, bandwidth: null };
    let i = s3[l4] + u3 * n[l4], a3 = s3[l4] - u3 * n[l4], m2 = s3[l4] !== 0 ? d4((i - a3) / s3[l4] * 100, c2) : null;
    return { mid: s3[l4], upper: d4(i, c2), lower: d4(a3, c2), bandwidth: m2 };
  });
}
function G2(e2, t = {}) {
  let { period: r = 9, kPeriod: u3 = 3, dPeriod: c2 = 3, decimals: s3 } = t, n = [], o = 50, l4 = 50, i = [], a3 = 0, m2 = [], f3 = 0, h3 = 0;
  for (let b3 = 0; b3 < e2.length; b3++) {
    let p3 = e2[b3];
    if (p3.high === null || p3.low === null) h3++;
    else {
      for (; i.length > a3 && e2[i[i.length - 1]].high <= p3.high; ) i.pop();
      for (i.push(b3); m2.length > f3 && e2[m2[m2.length - 1]].low >= p3.low; ) m2.pop();
      m2.push(b3);
    }
    let g2 = b3 - r + 1;
    if (b3 >= r) {
      let R4 = e2[b3 - r];
      (R4.high === null || R4.low === null) && h3--;
    }
    for (; i.length > a3 && i[a3] < g2; ) a3++;
    for (; m2.length > f3 && m2[f3] < g2; ) f3++;
    if (b3 < r - 1) {
      n.push({ k: null, d: null, j: null });
      continue;
    }
    let y3 = i.length > a3 ? e2[i[a3]].high : -1 / 0, w = m2.length > f3 ? e2[m2[f3]].low : 1 / 0, v4 = e2[b3].close;
    if (h3 > 0 || v4 === null || y3 === w) {
      n.push({ k: null, d: null, j: null });
      continue;
    }
    let S2 = (v4 - w) / (y3 - w) * 100;
    o = (u3 - 1) / u3 * o + 1 / u3 * S2, l4 = (c2 - 1) / c2 * l4 + 1 / c2 * o;
    let L2 = 3 * o - 2 * l4;
    n.push({ k: d4(o, s3), d: d4(l4, s3), j: d4(L2, s3) });
  }
  return n;
}
function U(e2, t = {}) {
  let { periods: r = [6, 12, 24], decimals: u3 } = t, c2 = [null];
  for (let n = 1; n < e2.length; n++) e2[n] === null || e2[n - 1] === null ? c2.push(null) : c2.push(e2[n] - e2[n - 1]);
  let s3 = {};
  for (let n of r) {
    let o = [], l4 = 0, i = 0;
    for (let a3 = 0; a3 < e2.length; a3++) {
      if (a3 < n) {
        o.push(null), c2[a3] !== null && (c2[a3] > 0 ? l4 += c2[a3] : i += Math.abs(c2[a3]));
        continue;
      }
      if (a3 === n) c2[a3] !== null && (c2[a3] > 0 ? l4 += c2[a3] : i += Math.abs(c2[a3])), l4 = l4 / n, i = i / n;
      else {
        let m2 = c2[a3] ?? 0, f3 = m2 > 0 ? m2 : 0, h3 = m2 < 0 ? Math.abs(m2) : 0;
        l4 = (l4 * (n - 1) + f3) / n, i = (i * (n - 1) + h3) / n;
      }
      if (i === 0) o.push(100);
      else if (l4 === 0) o.push(0);
      else {
        let m2 = l4 / i;
        o.push(d4(100 - 100 / (1 + m2), u3));
      }
    }
    s3[`rsi${n}`] = o;
  }
  return e2.map((n, o) => {
    let l4 = {};
    for (let i of r) l4[`rsi${i}`] = s3[`rsi${i}`][o];
    return l4;
  });
}
function Y(e2, t = {}) {
  let { periods: r = [6, 10], decimals: u3 } = t, c2 = {};
  for (let s3 of r) {
    let n = [];
    for (let o = 0; o < e2.length; o++) {
      if (o < s3 - 1) {
        n.push(null);
        continue;
      }
      let l4 = -1 / 0, i = 1 / 0, a3 = true;
      for (let h3 = o - s3 + 1; h3 <= o; h3++) {
        if (e2[h3].high === null || e2[h3].low === null) {
          a3 = false;
          break;
        }
        l4 = Math.max(l4, e2[h3].high), i = Math.min(i, e2[h3].low);
      }
      let m2 = e2[o].close;
      if (!a3 || m2 === null || l4 === i) {
        n.push(null);
        continue;
      }
      let f3 = (l4 - m2) / (l4 - i) * 100;
      n.push(d4(f3, u3));
    }
    c2[`wr${s3}`] = n;
  }
  return e2.map((s3, n) => {
    let o = {};
    for (let l4 of r) o[`wr${l4}`] = c2[`wr${l4}`][n];
    return o;
  });
}
function z(e2, t = {}) {
  let { periods: r = [6, 12, 24], decimals: u3 } = t, c2 = {};
  for (let s3 of r) {
    let n = j(e2, s3, u3), o = [];
    for (let l4 = 0; l4 < e2.length; l4++) if (e2[l4] === null || n[l4] === null || n[l4] === 0) o.push(null);
    else {
      let i = (e2[l4] - n[l4]) / n[l4] * 100;
      o.push(d4(i, u3));
    }
    c2[`bias${s3}`] = o;
  }
  return e2.map((s3, n) => {
    let o = {};
    for (let l4 of r) o[`bias${l4}`] = c2[`bias${l4}`][n];
    return o;
  });
}
function Q(e2, t = {}) {
  let { period: r = 14, decimals: u3 } = t, c2 = [], s3 = e2.map((n) => n.high === null || n.low === null || n.close === null ? null : (n.high + n.low + n.close) / 3);
  for (let n = 0; n < e2.length; n++) {
    if (n < r - 1) {
      c2.push({ cci: null });
      continue;
    }
    let o = 0, l4 = 0;
    for (let f3 = n - r + 1; f3 <= n; f3++) s3[f3] !== null && (o += s3[f3], l4++);
    if (l4 !== r || s3[n] === null) {
      c2.push({ cci: null });
      continue;
    }
    let i = o / r, a3 = 0;
    for (let f3 = n - r + 1; f3 <= n; f3++) a3 += Math.abs(s3[f3] - i);
    let m2 = a3 / r;
    if (m2 === 0) c2.push({ cci: 0 });
    else {
      let f3 = (s3[n] - i) / (0.015 * m2);
      c2.push({ cci: d4(f3, u3) });
    }
  }
  return c2;
}
function P(e2, t = {}) {
  let { period: r = 14, decimals: u3 } = t, c2 = Number.isInteger(r) && r >= 1, s3 = [], n = [];
  for (let l4 = 0; l4 < e2.length; l4++) {
    let { high: i, low: a3, close: m2 } = e2[l4];
    if (i === null || a3 === null || m2 === null) {
      n.push(null);
      continue;
    }
    if (l4 === 0) n.push(i - a3);
    else {
      let f3 = e2[l4 - 1].close;
      if (f3 === null) n.push(i - a3);
      else {
        let h3 = i - a3, b3 = Math.abs(i - f3), p3 = Math.abs(a3 - f3);
        n.push(Math.max(h3, b3, p3));
      }
    }
  }
  let o = null;
  for (let l4 = 0; l4 < e2.length; l4++) {
    if (!c2 || l4 < r - 1) {
      s3.push({ tr: n[l4] !== null ? d4(n[l4], u3) : null, atr: null });
      continue;
    }
    if (o === null) {
      let i = 0, a3 = 0;
      for (let m2 = l4 - r + 1; m2 <= l4; m2++) n[m2] !== null && (i += n[m2], a3++);
      a3 === r && (o = i / r);
    } else n[l4] !== null && (o = (o * (r - 1) + n[l4]) / r);
    s3.push({ tr: n[l4] !== null ? d4(n[l4], u3) : null, atr: o !== null ? d4(o, u3) : null });
  }
  return s3;
}
function X(e2, t = {}) {
  let { maPeriod: r } = t, u3 = [];
  if (e2.length === 0) return u3;
  let c2 = e2[0].volume ?? 0;
  u3.push({ obv: c2, obvMa: null });
  for (let s3 = 1; s3 < e2.length; s3++) {
    let n = e2[s3], o = e2[s3 - 1];
    if (n.close === null || o.close === null || n.volume === null || n.volume === void 0) {
      u3.push({ obv: null, obvMa: null });
      continue;
    }
    n.close > o.close ? c2 += n.volume : n.close < o.close && (c2 -= n.volume), u3.push({ obv: c2, obvMa: null });
  }
  if (r && r > 0) {
    let s3 = u3.map((o) => o.obv), n = new A(s3, r);
    for (let o = 0; o < u3.length; o++) n.advance(o), o >= r - 1 && n.nonNullCount === r && (u3[o].obvMa = n.value / r);
  }
  return u3;
}
function Z(e2, t = {}) {
  let { period: r = 12, signalPeriod: u3 } = t, c2 = [];
  for (let s3 = 0; s3 < e2.length; s3++) {
    if (s3 < r) {
      c2.push({ roc: null, signal: null });
      continue;
    }
    let n = e2[s3].close, o = e2[s3 - r].close;
    if (n === null || o === null || o === 0) {
      c2.push({ roc: null, signal: null });
      continue;
    }
    let l4 = (n - o) / o * 100;
    c2.push({ roc: l4, signal: null });
  }
  if (u3 && u3 > 0) {
    let s3 = c2.map((o) => o.roc), n = new A(s3, u3);
    for (let o = 0; o < c2.length; o++) n.advance(o), o >= r + u3 - 1 && n.nonNullCount === u3 && (c2[o].signal = n.value / u3);
  }
  return c2;
}
function ee(e2, t = {}) {
  let { period: r = 14, adxPeriod: u3 = r } = t, c2 = [];
  if (e2.length < 2) return e2.map(() => ({ pdi: null, mdi: null, adx: null, adxr: null }));
  let s3 = [], n = [], o = [];
  for (let p3 = 0; p3 < e2.length; p3++) {
    if (p3 === 0) {
      s3.push(0), n.push(0), o.push(0), c2.push({ pdi: null, mdi: null, adx: null, adxr: null });
      continue;
    }
    let g2 = e2[p3], y3 = e2[p3 - 1];
    if (g2.high === null || g2.low === null || g2.close === null || y3.high === null || y3.low === null || y3.close === null) {
      s3.push(0), n.push(0), o.push(0), c2.push({ pdi: null, mdi: null, adx: null, adxr: null });
      continue;
    }
    let w = g2.high - g2.low, v4 = Math.abs(g2.high - y3.close), S2 = Math.abs(g2.low - y3.close);
    o.push(Math.max(w, v4, S2));
    let L2 = g2.high - y3.high, R4 = y3.low - g2.low;
    L2 > R4 && L2 > 0 ? s3.push(L2) : s3.push(0), R4 > L2 && R4 > 0 ? n.push(R4) : n.push(0), c2.push({ pdi: null, mdi: null, adx: null, adxr: null });
  }
  let l4 = 0, i = 0, a3 = 0, m2 = [];
  for (let p3 = 1; p3 < e2.length; p3++) {
    if (p3 < r) {
      l4 += o[p3], i += s3[p3], a3 += n[p3], m2.push(0);
      continue;
    }
    p3 === r ? (l4 += o[p3], i += s3[p3], a3 += n[p3]) : (l4 = l4 - l4 / r + o[p3], i = i - i / r + s3[p3], a3 = a3 - a3 / r + n[p3]);
    let g2 = l4 > 0 ? i / l4 * 100 : 0, y3 = l4 > 0 ? a3 / l4 * 100 : 0;
    c2[p3].pdi = g2, c2[p3].mdi = y3;
    let w = g2 + y3, v4 = w > 0 ? Math.abs(g2 - y3) / w * 100 : 0;
    m2.push(v4);
  }
  let f3 = 0, h3 = 0, b3 = r + u3 - 1;
  for (let p3 = r; p3 < e2.length; p3++) {
    if (p3 < b3) {
      f3 += m2[p3 - 1] || 0;
      continue;
    }
    if (p3 === b3) f3 += m2[p3 - 1] || 0, h3 = f3 / u3, c2[p3].adx = h3;
    else {
      let g2 = m2[p3 - 1] || 0;
      h3 = (h3 * (u3 - 1) + g2) / u3, c2[p3].adx = h3;
    }
  }
  for (let p3 = b3 + u3; p3 < e2.length; p3++) {
    let g2 = c2[p3].adx, y3 = c2[p3 - u3]?.adx;
    g2 !== null && y3 !== null && (c2[p3].adxr = (g2 + y3) / 2);
  }
  return c2;
}
function te(e2, t = {}) {
  let { afStart: r = 0.02, afIncrement: u3 = 0.02, afMax: c2 = 0.2 } = t, s3 = [];
  if (e2.length < 2) return e2.map(() => ({ sar: null, trend: null, ep: null, af: null }));
  let n = 0;
  for (; n < e2.length && (e2[n].high === null || e2[n].low === null); ) n++;
  if (n >= e2.length - 1) return e2.map(() => ({ sar: null, trend: null, ep: null, af: null }));
  let o = 1, l4 = r, i = e2[n].high, a3 = e2[n].low, m2 = e2[n], f3 = e2[n + 1];
  m2.close !== null && f3.close !== null && f3.close < m2.close && (o = -1, i = m2.low, a3 = m2.high);
  for (let h3 = 0; h3 <= n; h3++) s3.push({ sar: null, trend: null, ep: null, af: null });
  for (let h3 = n + 1; h3 < e2.length; h3++) {
    let b3 = e2[h3], p3 = e2[h3 - 1];
    if (b3.high === null || b3.low === null || p3.high === null || p3.low === null) {
      s3.push({ sar: null, trend: null, ep: null, af: null });
      continue;
    }
    let g2 = a3 + l4 * (i - a3);
    o === 1 ? (g2 = Math.min(g2, p3.low, e2[Math.max(n, h3 - 2)]?.low ?? p3.low), b3.low < g2 ? (o = -1, g2 = i, i = b3.low, l4 = r) : b3.high > i && (i = b3.high, l4 = Math.min(l4 + u3, c2))) : (g2 = Math.max(g2, p3.high, e2[Math.max(n, h3 - 2)]?.high ?? p3.high), b3.high > g2 ? (o = 1, g2 = i, i = b3.high, l4 = r) : b3.low < i && (i = b3.low, l4 = Math.min(l4 + u3, c2))), a3 = g2, s3.push({ sar: a3, trend: o, ep: i, af: l4 });
  }
  return s3;
}
function ne(e2, t = {}) {
  let { emaPeriod: r = 20, atrPeriod: u3 = 10, multiplier: c2 = 2 } = t, s3 = [], n = e2.map((i) => i.close), o = D(n, r), l4 = P(e2, { period: u3 });
  for (let i = 0; i < e2.length; i++) {
    let a3 = o[i], m2 = l4[i]?.atr;
    if (a3 === null || m2 === null) {
      s3.push({ mid: null, upper: null, lower: null, width: null });
      continue;
    }
    let f3 = a3 + c2 * m2, h3 = a3 - c2 * m2, b3 = a3 > 0 ? (f3 - h3) / a3 * 100 : null;
    s3.push({ mid: a3, upper: f3, lower: h3, width: b3 });
  }
  return s3;
}
var k = 150;
function re(e2) {
  return e2.open !== null && e2.high !== null && e2.low !== null && e2.close !== null;
}
function pe(e2) {
  return Number(e2.toPrecision(12));
}
function E3(e2) {
  return Number(e2.toFixed(2));
}
function ue(e2) {
  return { date: e2, profitRatio: null, avgCost: null, cost90Low: null, cost90High: null, concentration90: null, cost70Low: null, cost70High: null, concentration70: null };
}
function fe(e2, t = {}) {
  let { range: r = 120, tail: u3, includeHistogram: c2 = false, decimals: s3 = 3 } = t, n = e2.length;
  if (n === 0) return [];
  let o = u3 !== void 0 ? n - Math.min(n, Math.max(0, Math.floor(u3))) : 0, l4 = c2 === true ? "last" : c2 || false, i = [];
  for (let a3 = o; a3 < n; a3++) {
    let m2 = l4 === "all" || l4 === "last" && a3 === n - 1;
    i.push(he(e2, a3, r, s3, m2));
  }
  return i;
}
function he(e2, t, r, u3, c2) {
  let s3 = e2[t].date, n = r ? Math.max(0, t - r + 1) : 0, o = e2.slice(n, Math.max(1, t + 1)), l4 = -1 / 0, i = 1 / 0, a3 = false;
  for (let R4 of o) re(R4) && (a3 = true, l4 = Math.max(l4, R4.high), i = Math.min(i, R4.low));
  if (!a3) return ue(s3);
  let m2 = Math.max(0.01, (l4 - i) / (k - 1)), f3 = new Array(k).fill(0);
  for (let R4 of o) {
    if (!re(R4)) continue;
    let { open: I2, close: x, high: C, low: M2 } = R4, K3 = (I2 + x + C + M2) / 4, B3 = Math.max(0, Math.min(1, (R4.turnoverRate ?? 0) / 100 || 0)), _3 = (O2) => Math.min(k - 1, Math.max(0, O2)), se2 = _3(Math.floor((C - i) / m2)), ie2 = _3(Math.ceil((M2 - i) / m2)), V3 = C === M2 ? k - 1 : 2 / (C - M2), ce = _3(Math.floor((K3 - i) / m2));
    for (let O2 = 0; O2 < f3.length; O2++) f3[O2] *= 1 - B3;
    if (C === M2) f3[ce] += V3 * B3 / 2;
    else for (let O2 = ie2; O2 <= se2; O2++) {
      let $2 = i + m2 * O2;
      $2 <= K3 ? f3[O2] += Math.abs(K3 - M2) < 1e-8 ? V3 * B3 : ($2 - M2) / (K3 - M2) * V3 * B3 : f3[O2] += Math.abs(C - K3) < 1e-8 ? V3 * B3 : (C - $2) / (C - K3) * V3 * B3;
    }
  }
  let h3 = new Array(k), b3 = 0;
  for (let R4 = 0; R4 < k; R4++) h3[R4] = pe(f3[R4]), b3 += h3[R4];
  if (b3 === 0) return ue(s3);
  let p3 = (R4) => {
    let I2 = 0, x = 0;
    for (let C = 0; C < k; C++) {
      let M2 = h3[C];
      if (x + M2 > R4) {
        I2 = i + C * m2;
        break;
      }
      x += M2;
    }
    return I2;
  }, g2 = (R4) => {
    let I2 = 0;
    for (let x = 0; x < k; x++) R4 >= i + x * m2 && (I2 += h3[x]);
    return I2 / b3;
  }, y3 = (R4) => {
    let I2 = p3(b3 * ((1 - R4) / 2)), x = p3(b3 * ((1 + R4) / 2));
    return { low: E3(I2), high: E3(x), concentration: I2 + x === 0 ? 0 : (x - I2) / (I2 + x) };
  }, w = e2[t].close, v4 = y3(0.9), S2 = y3(0.7), L2 = { date: s3, profitRatio: w !== null ? d4(g2(w), u3) : null, avgCost: E3(p3(b3 * 0.5)), cost90Low: v4.low, cost90High: v4.high, concentration90: d4(v4.concentration, u3), cost70Low: S2.low, cost70High: S2.high, concentration70: d4(S2.concentration, u3) };
  if (c2) {
    let R4 = new Array(k), I2 = new Array(k);
    for (let x = 0; x < k; x++) R4[x] = E3(i + m2 * x), I2[x] = d4(h3[x] / b3, 6);
    L2.histogram = { prices: R4, ratios: I2 };
  }
  return L2;
}
function W(e2, t = 0) {
  return e2.length === 0 ? t : Math.max(...e2);
}
function oe(e2) {
  return { closes: e2.map((t) => t.close), ohlcv: e2.map((t) => ({ open: t.open, high: t.high, low: t.low, close: t.close, volume: t.volume })) };
}
var H = { ma: { key: "ma", estimateLookback: (e2) => {
  let t = typeof e2 == "object" ? e2 : {}, r = t.periods ?? [5, 10, 20, 30, 60, 120, 250], u3 = t.type ?? "sma";
  return { bars: W(r, 20), emaBased: u3 === "ema" };
}, compute: (e2, t) => J2(e2.closes, typeof t == "object" ? t : {}) }, macd: { key: "macd", recursive: true, estimateLookback: (e2) => {
  let t = typeof e2 == "object" ? e2 : {}, r = t.long ?? 26, u3 = t.signal ?? 9;
  return { bars: r * 3 + u3, emaBased: true };
}, compute: (e2, t) => F2(e2.closes, typeof t == "object" ? t : {}) }, boll: { key: "boll", estimateLookback: (e2) => ({ bars: typeof e2 == "object" && e2.period ? e2.period : 20 }), compute: (e2, t) => q(e2.closes, typeof t == "object" ? t : {}) }, kdj: { key: "kdj", recursive: true, estimateLookback: (e2) => ({ bars: typeof e2 == "object" && e2.period ? e2.period : 9 }), compute: (e2, t) => G2(e2.ohlcv, typeof t == "object" ? t : {}) }, rsi: { key: "rsi", recursive: true, estimateLookback: (e2) => {
  let t = typeof e2 == "object" && e2.periods ? e2.periods : [6, 12, 24];
  return { bars: W(t, 14) + 1 };
}, compute: (e2, t) => U(e2.closes, typeof t == "object" ? t : {}) }, wr: { key: "wr", estimateLookback: (e2) => {
  let t = typeof e2 == "object" && e2.periods ? e2.periods : [6, 10];
  return { bars: W(t, 10) };
}, compute: (e2, t) => Y(e2.ohlcv, typeof t == "object" ? t : {}) }, bias: { key: "bias", estimateLookback: (e2) => {
  let t = typeof e2 == "object" && e2.periods ? e2.periods : [6, 12, 24];
  return { bars: W(t, 12) };
}, compute: (e2, t) => z(e2.closes, typeof t == "object" ? t : {}) }, cci: { key: "cci", estimateLookback: (e2) => ({ bars: typeof e2 == "object" && e2.period ? e2.period : 14 }), compute: (e2, t) => Q(e2.ohlcv, typeof t == "object" ? t : {}) }, atr: { key: "atr", recursive: true, estimateLookback: (e2) => ({ bars: typeof e2 == "object" && e2.period ? e2.period : 14 }), compute: (e2, t) => P(e2.ohlcv, typeof t == "object" ? t : {}) }, obv: { key: "obv", cumulative: true, estimateLookback: (e2) => {
  let t = typeof e2 == "object" && e2.maPeriod ? e2.maPeriod : 0;
  return { bars: Math.max(2, t) };
}, compute: (e2, t) => X(e2.ohlcv, typeof t == "object" ? t : {}) }, roc: { key: "roc", estimateLookback: (e2) => {
  let t = typeof e2 == "object" ? e2 : {}, r = t.period ?? 12, u3 = t.signalPeriod ?? 0;
  return { bars: r + u3 };
}, compute: (e2, t) => Z(e2.ohlcv, typeof t == "object" ? t : {}) }, dmi: { key: "dmi", recursive: true, estimateLookback: (e2) => {
  let t = typeof e2 == "object" ? e2 : {}, r = t.period ?? 14, u3 = t.adxPeriod ?? r;
  return { bars: r * 2 + u3 };
}, compute: (e2, t) => ee(e2.ohlcv, typeof t == "object" ? t : {}) }, sar: { key: "sar", recursive: true, estimateLookback: () => ({ bars: 5 }), compute: (e2, t) => te(e2.ohlcv, typeof t == "object" ? t : {}) }, kc: { key: "kc", recursive: true, estimateLookback: (e2) => {
  let t = typeof e2 == "object" ? e2 : {}, r = t.emaPeriod ?? 20, u3 = t.atrPeriod ?? 10;
  return { bars: Math.max(r * 3, u3), emaBased: true };
}, compute: (e2, t) => ne(e2.ohlcv, typeof t == "object" ? t : {}) } };
var be = ["ma", "rsi", "wr", "bias"];
function N(e2) {
  let t = null;
  for (let r of be) {
    let u3 = e2[r];
    if (Array.isArray(u3)) (t ?? (t = { ...e2 }))[r] = { periods: u3 };
    else if (u3 && typeof u3 == "object" && !("periods" in u3) && typeof u3.period == "number") {
      let { period: c2, ...s3 } = u3;
      (t ?? (t = { ...e2 }))[r] = { ...s3, periods: [c2] };
    }
  }
  return t ?? e2;
}
function de(e2) {
  return T2(N(e2)).some((t) => H[t].cumulative === true);
}
function T2(e2) {
  return Object.keys(H).filter((t) => !!e2[t]);
}
function ge(e2) {
  e2 = N(e2);
  let t = 0, r = 0, u3 = false;
  for (let s3 of T2(e2)) {
    let n = H[s3], o = n.estimateLookback(e2[s3]);
    t = Math.max(t, o.bars), u3 || (u3 = !!o.emaBased), (n.recursive === true || o.emaBased === true) && (r = Math.max(r, o.bars));
  }
  return { maxLookback: t, hasEmaBasedIndicator: u3, requiredBars: Math.ceil(t * (u3 ? 1.5 : 1.2)), maxRecursiveLookback: r };
}
function Re(e2, t = {}) {
  if (e2.length === 0) return [];
  t = N(t);
  let r = oe(e2), u3 = /* @__PURE__ */ new Map();
  for (let n of T2(t)) {
    let o = H[n];
    u3.set(n, o.compute(r, t[n]));
  }
  let c2 = [], s3 = [];
  for (let [n, o] of u3) c2.push(n), s3.push(o);
  return e2.map((n, o) => {
    let l4 = { ...n }, i = l4;
    for (let a3 = 0; a3 < c2.length; a3++) i[c2[a3]] = s3[a3][o];
    return l4;
  });
}

// node_modules/stock-sdk/dist/chunk-4RN7AVFQ.js
function I(e2) {
  if (e2.startsWith("92") || /^[48]/.test(e2)) return "BSE";
  let t = e2[0];
  return t === "6" || t === "5" || t === "9" ? "SSE" : "SZSE";
}
var y = { SHFE: { market: "CN", exchange: "SHFE" }, DCE: { market: "CN", exchange: "DCE" }, CZCE: { market: "CN", exchange: "CZCE" }, INE: { market: "CN", exchange: "INE" }, CFFEX: { market: "CN", exchange: "CFFEX" }, GFEX: { market: "CN", exchange: "GFEX" }, COMEX: { market: "GLOBAL", exchange: "COMEX" }, NYMEX: { market: "GLOBAL", exchange: "NYMEX" }, CBOT: { market: "GLOBAL", exchange: "CBOT" }, LME: { market: "GLOBAL", exchange: "LME" } };
function A2(e2) {
  let t = e2.match(/^([A-Za-z]+)/);
  return (t ? t[1] : e2).toUpperCase();
}
var H2 = { market: "CN", exchange: "CSI", secidPrefix: "2" };
var D2 = [/^93\d{4}$/, /^H\d{5}$/];
var U2 = { HSHCI: { market: "HK", exchange: "HSI", secidPrefix: "124" }, HSI: { market: "HK", exchange: "HSI", secidPrefix: "100", tencent: "hkHSI", collision: true }, HSCEI: { market: "HK", exchange: "HSI", secidPrefix: "100", tencent: "hkHSCEI", collision: true }, HSTECH: { market: "HK", exchange: "HSI", tencent: "hkHSTECH", collision: true }, DJI: { market: "US", exchange: "US", secidPrefix: "100", eastmoneyCode: "DJIA", tencent: "usDJI", collision: true }, INX: { market: "US", exchange: "US", secidPrefix: "100", eastmoneyCode: "SPX", tencent: "usINX", collision: true }, IXIC: { market: "US", exchange: "US", secidPrefix: "100", eastmoneyCode: "NDX", tencent: "usIXIC", collision: true }, GDAXI: { market: "GLOBAL", exchange: "DAX", secidPrefix: "100" } };
var R2 = [[H2.exchange, H2.market], ...Object.values(U2).map((e2) => [e2.exchange, e2.market])];
function E4(e2) {
  let t = e2.toUpperCase();
  if (D2.some((i) => i.test(t))) return { ...H2, code: t };
  let c2 = U2[t];
  return c2 ? { ...c2, code: t } : void 0;
}
function V(e2) {
  let t = e2.indexOf(".");
  if (t <= 0) return;
  let c2 = e2.slice(0, t), i = e2.slice(t + 1).toUpperCase();
  for (let [n, d6] of Object.entries(U2)) if (d6.secidPrefix === c2 && (d6.eastmoneyCode ?? n) === i) return { ...d6, code: n };
}
var N2 = { sh: { market: "CN", exchange: "SSE" }, sz: { market: "CN", exchange: "SZSE" }, bj: { market: "CN", exchange: "BSE" }, hk: { market: "HK", exchange: "HKEX" }, us: { market: "US", exchange: "US" } };
var L = Object.keys(N2);
var K = { 0: { market: "CN", exchange: "SZSE" }, 1: { market: "CN", exchange: "SSE" }, 116: { market: "HK", exchange: "HKEX" }, 105: { market: "US", exchange: "NASDAQ" }, 106: { market: "US", exchange: "NYSE" }, 107: { market: "US", exchange: "AMEX" } };
var F3 = { 0: ["SZSE", "BSE"] };
var Z2 = { SSE: "CN", SZSE: "CN", BSE: "CN", HKEX: "HK", NASDAQ: "US", NYSE: "US", AMEX: "US", US: "US", ...Object.fromEntries(R2), ...Object.fromEntries(Object.values(y).map((e2) => [e2.exchange, e2.market])) };
function _(e2, t, c2, i) {
  let n = i ?? [t.exchange], d6 = e2.toLowerCase();
  for (let a3 of L) {
    if (!d6.startsWith(a3) || e2.length <= a3.length) continue;
    let m2 = e2.slice(a3.length);
    if (!/^\d+$/.test(m2)) continue;
    let f3 = N2[a3];
    if (f3.market !== t.market || !n.includes(f3.exchange)) throw new R(`${c2} (prefix '${a3}' conflicts with resolved ${t.market}/${t.exchange})`);
    return { code: m2, exchange: f3.exchange };
  }
  return { code: e2, exchange: t.exchange };
}
function b(e2, t) {
  let c2 = typeof e2 == "string" ? { code: e2 } : { ...e2 }, i = typeof e2 == "string" ? e2 : e2.code, n = String(c2.code ?? "").trim(), d6 = c2.market ?? t?.market, a3 = c2.assetType ?? t?.assetType, m2 = c2.exchange ?? t?.exchange;
  if (!n) throw new R(String(i));
  let f3 = (r, o, s3, S2, T3, h3 = {}) => {
    if (d6 && d6 !== r) throw new R(`${i} (market hint '${d6}' conflicts with resolved market ${r})`);
    if (m2) {
      let l4 = Z2[m2];
      if (l4 && l4 !== r) throw new R(`${i} (exchange hint '${m2}' belongs to market ${l4}, conflicts with resolved market ${r})`);
      if (h3.exchange && m2 !== o) throw new R(`${i} (exchange hint '${m2}' conflicts with resolved exchange ${o})`);
    }
    if (a3 && a3 !== S2) {
      if (h3.assetType) throw new R(`${i} (assetType hint '${a3}' conflicts with resolved assetType ${S2})`);
      if (a3 === "board" || a3 === "futures") throw new R(`${i} (assetType hint '${a3}' conflicts with a ${S2}-shaped code)`);
    }
    return { market: r, exchange: m2 ?? o, assetType: a3 ?? S2, code: s3, variety: T3, input: i };
  }, w = (r) => f3(r.market, r.exchange, r.code, "index", void 0, { exchange: true, assetType: true }), X3 = (r, o) => o === "HK" && /^\d+$/.test(r) ? r.padStart(5, "0") : o === "US" ? r.toUpperCase() : r;
  if (n.includes(".")) {
    let r = n.indexOf("."), o = n.slice(0, r), s3 = n.slice(r + 1), S2 = o.toUpperCase(), T3 = s3.toUpperCase(), h3 = E4(s3);
    if (h3 && h3.secidPrefix === o) return w(h3);
    if (/^\d+$/.test(o) && K[o]) {
      let g2 = K[o], p3 = F3[o], C = _(s3, g2, i, p3), M2 = C.exchange, O2 = true;
      if (p3 && C.code === s3 && /^\d+$/.test(C.code)) {
        let P3 = I(C.code);
        p3.includes(P3) && (M2 = P3), O2 = false;
      }
      return f3(g2.market, M2, X3(C.code, g2.market), "stock", void 0, { exchange: O2 });
    }
    let l4 = s3.toLowerCase(), k3 = Object.prototype.hasOwnProperty.call(N2, l4) ? N2[l4] : void 0;
    if (k3) {
      if (k3.market === "CN" || k3.market === "HK") {
        let p3 = E4(o);
        if (p3 && !p3.collision) throw new R(`${i} (special index code '${p3.code}' conflicts with exchange suffix '${s3}'; use bare '${p3.code}' or secid '${p3.secidPrefix}.${p3.code}')`);
      }
      let g2 = _(o, k3, i);
      return f3(k3.market, g2.exchange, X3(g2.code, k3.market), "stock", void 0, { exchange: g2.exchange !== "US" });
    }
    if (y[S2]) {
      let g2 = y[S2];
      return f3(g2.market, g2.exchange, T3, "futures", A2(s3), { exchange: true, assetType: true });
    }
    if (o === "90") return f3("CN", "SSE", s3, "board", void 0, { exchange: true, assetType: true });
  }
  let G4 = n.toLowerCase();
  for (let r of L) if (G4.startsWith(r) && n.length > r.length) {
    let o = n.slice(r.length), s3 = N2[r], S2 = n.startsWith(r) && (/^[A-Z][A-Za-z0-9.\-]*$/.test(o) || /^[a-z]{3,}$/.test(o));
    if (s3.market === "CN" ? /^\d+$/.test(o) : /^\d+$/.test(o) || S2) {
      let h3 = E4(o);
      if (h3 && h3.collision && h3.market === s3.market && a3 !== "stock") return w(h3);
      if ((s3.market === "CN" || s3.market === "HK") && h3 && !h3.collision) throw new R(`${i} (special index code '${h3.code}' conflicts with exchange prefix '${r}'; use bare '${h3.code}' or secid '${h3.secidPrefix}.${h3.code}')`);
      let l4 = s3.market === "HK" ? o.toUpperCase().padStart(5, "0") : s3.market === "US" ? o.toUpperCase() : o;
      return f3(s3.market, s3.exchange, l4, "stock", void 0, { exchange: s3.exchange !== "US" });
    }
  }
  let $2 = E4(n);
  if ($2 && (!$2.collision || d6 === $2.market && a3 !== "stock")) return w($2);
  if (/^\d+$/.test(n)) return d6 === "US" ? f3("US", "US", n, "stock") : d6 === "CN" ? f3("CN", I(n), n, "stock") : d6 === "HK" || n.length === 5 || n.length === 4 ? f3("HK", "HKEX", n.padStart(5, "0"), "stock", void 0, { exchange: true }) : f3("CN", I(n), n, "stock");
  if ((a3 === "futures" || d6 === "GLOBAL") && /[A-Za-z]/.test(n)) {
    let r = m2;
    if (!r && d6 === "GLOBAL") throw new R(`${i} (GLOBAL futures require an explicit exchange, e.g. { exchange: 'COMEX' })`);
    let o = r ? y[String(r).toUpperCase()]?.market : void 0;
    return f3(d6 ?? o ?? "CN", r ?? "SHFE", n.toUpperCase(), "futures", A2(n), { assetType: true });
  }
  if (/^[A-Za-z][A-Za-z.\-]*$/.test(n)) return f3("US", "US", n.toUpperCase(), "stock");
  throw new R(String(i));
}
function j2(e2) {
  try {
    return b(e2).market;
  } catch {
    return;
  }
}
var B = { SSE: "1", SZSE: "0", BSE: "0", HKEX: "116", NASDAQ: "105", NYSE: "106", AMEX: "107", US: "105" };
var v2 = { SSE: "sh", SZSE: "sz", BSE: "bj" };
function z2(e2) {
  if (e2.assetType === "board" || e2.assetType === "futures" || e2.assetType === "option") throw new c(`Tencent quote symbol does not support assetType '${e2.assetType}'`, { assetType: e2.assetType, code: e2.code });
  if (e2.assetType === "index") {
    let t = E4(e2.code);
    if (t?.tencent && t.exchange === e2.exchange) return t.tencent;
  }
  switch (e2.market) {
    case "CN": {
      let t = v2[e2.exchange];
      if (!t) throw new c(`Cannot map to Tencent symbol: unsupported CN exchange '${e2.exchange}'`, { exchange: e2.exchange, code: e2.code });
      return `${t}${e2.code}`;
    }
    case "HK":
      if (!/^\d+$/.test(e2.code)) throw new c(`Cannot map to Tencent symbol: HK code '${e2.code}' is not numeric`, { market: e2.market, code: e2.code });
      return `hk${e2.code.padStart(5, "0")}`;
    case "US":
      return `us${e2.code}`;
    default:
      throw new c(`Cannot map to Tencent symbol: unsupported market '${e2.market}'`, { market: e2.market, code: e2.code });
  }
}
function q2(e2) {
  if (e2.assetType === "board") return `90.${e2.code}`;
  if (e2.assetType === "futures" || e2.assetType === "option") throw new c(`Eastmoney secid for assetType '${e2.assetType}' uses a separate scheme; use the dedicated futures/options provider instead of toEastmoneySecid`, { assetType: e2.assetType, exchange: e2.exchange, code: e2.code });
  if (e2.assetType === "index") {
    let c2 = E4(e2.code);
    if (c2 && c2.exchange === e2.exchange) {
      if (c2.secidPrefix) return `${c2.secidPrefix}.${c2.eastmoneyCode ?? c2.code}`;
      throw new c(`Eastmoney has no quote for special index '${c2.code}' (Tencent-only); use quotes.hk/quotes.us instead of kline for this index`, { code: c2.code, exchange: c2.exchange });
    }
  }
  if (e2.market === "HK") return `116.${e2.code.padStart(5, "0")}`;
  let t = B[e2.exchange];
  if (!t) throw new c(`Cannot map to Eastmoney secid: unsupported exchange '${e2.exchange}' (market=${e2.market})`, { exchange: e2.exchange, market: e2.market, code: e2.code });
  return `${t}.${e2.code}`;
}
function Y2(e2) {
  return e2.code;
}
function W2(e2, t) {
  let c2 = [], i = [], n = /* @__PURE__ */ new Set();
  for (let d6 of e2) try {
    let a3 = z2(b(d6, { market: t }));
    n.has(a3) || (n.add(a3), c2.push(a3));
  } catch (a3) {
    i.push({ code: d6, reason: a3 instanceof Error ? a3.message : String(a3) });
  }
  return { keys: c2, invalid: i };
}

// node_modules/stock-sdk/dist/chunk-LAT6L2TO.js
function h2(u3, t = {}) {
  let d6 = [];
  if (t.ma && u3.length > 0) {
    let { fast: e2, slow: a3 } = t.ma;
    if (!u3.some((l4) => l4.ma != null && l4.ma[`ma${e2}`] !== void 0 && l4.ma[`ma${a3}`] !== void 0)) throw new c(`calcSignals: MA periods {fast:${e2}, slow:${a3}} not found on klines \u2014 ensure addIndicators computed ma${e2}/ma${a3} (signal MA periods must match indicator periods).`, { fast: e2, slow: a3 });
  }
  if (t.rsi && u3.length > 0) {
    let e2 = t.rsi.period ?? 6;
    if (!u3.some((o) => o.rsi != null && o.rsi[`rsi${e2}`] !== void 0)) throw new c(`calcSignals: RSI period ${e2} not found on klines \u2014 ensure addIndicators computed rsi${e2} (signal RSI period must match indicator period).`, { period: e2 });
  }
  for (let e2 = 1; e2 < u3.length; e2++) {
    let a3 = u3[e2 - 1], o = u3[e2], l4 = o.timestamp;
    if (l4 != null) {
      if (t.ma) {
        let { fast: s3, slow: n } = t.ma, r = a3.ma?.[`ma${s3}`], i = a3.ma?.[`ma${n}`], c2 = o.ma?.[`ma${s3}`], p3 = o.ma?.[`ma${n}`];
        r != null && i != null && c2 != null && p3 != null && (r <= i && c2 > p3 ? d6.push({ type: "ma_golden_cross", at: l4, index: e2, detail: { fast: s3, slow: n } }) : r >= i && c2 < p3 && d6.push({ type: "ma_death_cross", at: l4, index: e2, detail: { fast: s3, slow: n } }));
      }
      if (t.macd) {
        let s3 = a3.macd?.dif, n = a3.macd?.dea, r = o.macd?.dif, i = o.macd?.dea;
        s3 != null && n != null && r != null && i != null && (s3 <= n && r > i ? d6.push({ type: "macd_golden_cross", at: l4, index: e2 }) : s3 >= n && r < i && d6.push({ type: "macd_death_cross", at: l4, index: e2 }));
      }
      if (t.kdj) {
        let s3 = t.kdj.overbought ?? 80, n = t.kdj.oversold ?? 20, r = a3.kdj?.k, i = a3.kdj?.d, c2 = o.kdj?.k, p3 = o.kdj?.d;
        r != null && i != null && c2 != null && p3 != null && (r <= i && c2 > p3 ? d6.push({ type: "kdj_golden_cross", at: l4, index: e2 }) : r >= i && c2 < p3 && d6.push({ type: "kdj_death_cross", at: l4, index: e2 })), c2 != null && (c2 > s3 ? d6.push({ type: "kdj_overbought", at: l4, index: e2, detail: { k: c2 } }) : c2 < n && d6.push({ type: "kdj_oversold", at: l4, index: e2, detail: { k: c2 } }));
      }
      if (t.rsi) {
        let s3 = t.rsi.period ?? 6, n = t.rsi.overbought ?? 70, r = t.rsi.oversold ?? 30, i = o.rsi?.[`rsi${s3}`];
        i != null && (i > n ? d6.push({ type: "rsi_overbought", at: l4, index: e2, detail: { rsi: i } }) : i < r && d6.push({ type: "rsi_oversold", at: l4, index: e2, detail: { rsi: i } }));
      }
      if (t.boll) {
        let s3 = o.close, n = o.boll?.upper, r = o.boll?.lower;
        s3 != null && n != null && s3 > n ? d6.push({ type: "boll_break_upper", at: l4, index: e2 }) : s3 != null && r != null && s3 < r && d6.push({ type: "boll_break_lower", at: l4, index: e2 });
      }
      if (t.sar) {
        let s3 = a3.sar?.trend, n = o.sar?.trend;
        s3 != null && n != null && s3 !== n && d6.push({ type: n === 1 ? "sar_reversal_up" : "sar_reversal_down", at: l4, index: e2 });
      }
    }
  }
  return d6;
}

// node_modules/stock-sdk/dist/chunk-WOT6VMZA.js
var d5 = Object.defineProperty;
var e = (c2, a3) => {
  for (var b3 in a3) d5(c2, b3, { get: a3[b3], enumerable: true });
};

// node_modules/stock-sdk/dist/chunk-2VTKUHMG.js
function qt(t) {
  return new TextDecoder("gbk").decode(t);
}
function $t(t) {
  let e2 = t.split(";").map((r) => r.trim()).filter(Boolean), n = [];
  for (let r of e2) {
    let o = r.indexOf("=");
    if (o < 0) continue;
    let i = r.slice(0, o).trim();
    i.startsWith("v_") && (i = i.slice(2));
    let s3 = r.slice(o + 1).trim();
    s3.startsWith('"') && s3.endsWith('"') && (s3 = s3.slice(1, -1));
    let a3 = s3.split("~");
    n.push({ key: i, fields: a3 });
  }
  return n;
}
function zt(t) {
  let e2 = t.trim();
  return e2 === "" || e2 === "-" || e2 === "--";
}
function R3(t) {
  if (!t || t === "") return 0;
  let e2 = parseFloat(t);
  return Number.isNaN(e2) ? 0 : e2;
}
function P2(t) {
  if (!t || zt(t)) return null;
  let e2 = parseFloat(t);
  return Number.isNaN(e2) ? null : e2;
}
function S(t) {
  if (!t || zt(t)) return null;
  let e2 = parseFloat(t);
  return Number.isNaN(e2) ? null : e2;
}
function u2(t) {
  return t == null ? null : S(String(t));
}
function A3(t) {
  if (t == null) return null;
  if (typeof t == "number") return Number.isFinite(t) ? t : null;
  if (zt(t)) return null;
  let e2 = Number(t);
  return Number.isFinite(e2) ? e2 : null;
}
var ps = /* @__PURE__ */ new Set(["daily", "weekly", "monthly"]);
var ms = /* @__PURE__ */ new Set(["1", "5", "15", "30", "60"]);
var gs = /* @__PURE__ */ new Set(["", "qfq", "hfq"]);
function ie(t, e2) {
  if (!Number.isFinite(t) || !Number.isInteger(t) || t <= 0) throw new c(`${e2} must be a positive integer`, { argument: e2, value: t });
}
function W3(t) {
  if (!ps.has(t)) throw new c("period must be one of: daily, weekly, monthly", { argument: "period", value: t });
}
function De(t) {
  if (!ms.has(t)) throw new c("period must be one of: 1, 5, 15, 30, 60", { argument: "period", value: t });
}
function se(t) {
  if (!gs.has(t)) throw new c("adjust must be one of: '', 'qfq', 'hfq'", { argument: "adjust", value: t });
}
function lt(t) {
  if (t !== "north" && t !== "south") throw new c("direction must be one of: 'north', 'south'", { argument: "direction", value: t });
}
function be2(t, e2) {
  ie(e2, "chunkSize");
  let n = [];
  for (let r = 0; r < t.length; r += e2) n.push(t.slice(r, r + e2));
  return n;
}
async function V2(t, e2, n = false) {
  if (ie(e2, "concurrency"), t.length === 0) return [];
  let r = n ? new Array(t.length) : [], o = 0, i = Array.from({ length: Math.min(e2, t.length) }, async () => {
    for (; ; ) {
      let s3 = o++;
      if (s3 >= t.length) return;
      let a3 = await t[s3]();
      n ? r[s3] = a3 : r.push(a3);
    }
  });
  return await Promise.all(i), r;
}
function Z3(t) {
  return { daily: "101", weekly: "102", monthly: "103" }[t];
}
function le2(t) {
  return { "": "0", qfq: "1", hfq: "2" }[t];
}
var fs = typeof document < "u" && typeof window < "u";
var ys = 0;
function Ir() {
  return `__stock_sdk_jsonp_${Date.now()}_${ys++}`;
}
function Nr(t) {
  let e2 = t, n = e2.indexOf("*/");
  n !== -1 && (e2 = e2.slice(n + 2).trim());
  let r = e2.indexOf("(");
  if (r === -1) throw new s({ code: "PARSE_ERROR", message: "Invalid JSONP response: no opening parenthesis found" });
  let o = e2.lastIndexOf(")");
  if (o === -1 || o <= r) throw new s({ code: "PARSE_ERROR", message: "Invalid JSONP response: no closing parenthesis found" });
  let i = e2.slice(r + 1, o);
  try {
    return JSON.parse(i);
  } catch (s3) {
    throw new s({ code: "PARSE_ERROR", message: "Invalid JSONP response: payload is not valid JSON", cause: s3 });
  }
}
function hs(t, e2) {
  let { timeout: n = 15e3, callbackParam: r = "callback", callbackMode: o = "query" } = e2;
  return new Promise((i, s3) => {
    let a3 = Ir(), c2;
    if (o === "path") c2 = t.replace("{callback}", a3);
    else {
      let f3 = t.includes("?") ? "&" : "?";
      c2 = `${t}${f3}${r}=${a3}`;
    }
    let l4 = document.createElement("script"), d6 = false, p3 = window, g2 = () => {
      l4.parentNode && l4.parentNode.removeChild(l4), delete p3[a3];
    }, m2 = setTimeout(() => {
      d6 || (d6 = true, g2(), s3(new s({ code: "TIMEOUT", message: `JSONP request timed out after ${n}ms: ${t}`, url: t, details: { timeout: n } })));
    }, n);
    p3[a3] = (f3) => {
      d6 || (d6 = true, clearTimeout(m2), g2(), i(f3));
    }, l4.onerror = () => {
      d6 || (d6 = true, clearTimeout(m2), g2(), s3(new s({ code: "NETWORK_ERROR", message: `JSONP script load failed: ${t}`, url: t })));
    }, l4.src = c2, document.head.appendChild(l4);
  });
}
async function Ts(t, e2) {
  let { timeout: n = 15e3, callbackParam: r = "callback", callbackMode: o = "query" } = e2, i = Ir(), s3;
  if (o === "path") s3 = t.replace("{callback}", i);
  else {
    let l4 = t.includes("?") ? "&" : "?";
    s3 = `${t}${l4}${r}=${i}`;
  }
  let a3 = new AbortController(), c2 = setTimeout(() => a3.abort(), n);
  try {
    let l4 = await fetch(s3, { signal: a3.signal });
    if (!l4.ok) throw new u(l4.status, l4.statusText, t);
    let d6 = await l4.text();
    return Nr(d6);
  } catch (l4) {
    throw l4 instanceof DOMException && l4.name === "AbortError" ? new s({ code: "TIMEOUT", message: `JSONP request timed out after ${n}ms: ${t}`, url: t, details: { timeout: n } }) : l4 instanceof s ? l4 : new s({ code: "NETWORK_ERROR", message: `JSONP request failed: ${l4 instanceof Error ? l4.message : String(l4)}`, url: t, cause: l4 });
  } finally {
    clearTimeout(c2);
  }
}
function K2(t, e2 = {}) {
  return fs ? hs(t, e2) : Ts(t, e2);
}
var kr = /* @__PURE__ */ new Map();
async function Yt(t, e2) {
  let r = (kr.get(t) ?? Promise.resolve()).then(e2, e2);
  return kr.set(t, r.then(() => {
  }, () => {
  })), r;
}
function Ss() {
  return typeof document < "u" && typeof window < "u";
}
var Rs = 15e3;
var Es = "jsVars";
async function de2(t, e2, n = {}) {
  let r = n.timeout ?? Rs;
  return Ss() ? Yt(n.mutexKey ?? Es, () => _s(t, e2, r)) : Cs(t, e2, r, n.headers, n.client);
}
function jt(t, e2) {
  let n = {};
  for (let r of e2) {
    let o = As(t, r);
    o !== void 0 && (n[r] = o);
  }
  return n;
}
function _s(t, e2, n) {
  return new Promise((r, o) => {
    let i = window, s3 = document.createElement("script"), a3 = false, c2 = () => {
      for (let p3 of e2) try {
        i[p3] = void 0;
      } catch {
      }
    };
    c2();
    let l4 = () => {
      s3.parentNode && s3.parentNode.removeChild(s3);
    }, d6 = setTimeout(() => {
      a3 || (a3 = true, s3.onload = c2, s3.onerror = null, l4(), o(new s({ code: "TIMEOUT", message: `fetchJsVars timed out after ${n}ms: ${t}`, url: t, details: { timeout: n } })));
    }, n);
    s3.onload = () => {
      if (a3) return;
      a3 = true, clearTimeout(d6);
      let p3 = {};
      for (let g2 of e2) {
        g2 in i && i[g2] !== void 0 && (p3[g2] = i[g2]);
        try {
          delete i[g2];
        } catch {
          try {
            i[g2] = void 0;
          } catch {
          }
        }
      }
      l4(), r(p3);
    }, s3.onerror = () => {
      a3 || (a3 = true, clearTimeout(d6), l4(), o(new s({ code: "NETWORK_ERROR", message: `fetchJsVars script load failed: ${t}`, url: t })));
    }, s3.src = t, document.head.appendChild(s3);
  });
}
async function Cs(t, e2, n, r, o) {
  if (o) {
    let a3 = await o.get(t, { responseType: "text" });
    return jt(a3, e2);
  }
  let i = new AbortController(), s3 = setTimeout(() => i.abort(), n);
  try {
    let a3 = await fetch(t, { signal: i.signal, headers: r });
    if (!a3.ok) throw new u(a3.status, a3.statusText, t);
    let c2 = await a3.text();
    return jt(c2, e2);
  } catch (a3) {
    throw a3 instanceof DOMException && a3.name === "AbortError" ? new s({ code: "TIMEOUT", message: `fetchJsVars timed out after ${n}ms: ${t}`, url: t, details: { timeout: n } }) : a3 instanceof s ? a3 : new s({ code: "NETWORK_ERROR", message: `fetchJsVars failed: ${a3 instanceof Error ? a3.message : String(a3)}`, url: t, cause: a3 });
  } finally {
    clearTimeout(s3);
  }
}
function As(t, e2) {
  let r = new RegExp(`(?:^|[^\\w$])(?:var|let|const)\\s+${Ps(e2)}\\s*=\\s*`, "m").exec(t);
  if (!r) return;
  let o = r.index + r[0].length, i = Ds(t, o), s3 = t.slice(o, i).trim();
  try {
    return JSON.parse(s3);
  } catch {
    try {
      return JSON.parse(Os(s3));
    } catch {
      return;
    }
  }
}
function Os(t) {
  let e2 = "", n = null;
  for (let r = 0; r < t.length; r++) {
    let o = t[r];
    if (n === '"') {
      e2 += o, o === "\\" && r + 1 < t.length ? e2 += t[++r] : o === '"' && (n = null);
      continue;
    }
    if (n === "'") {
      if (o === "\\" && r + 1 < t.length) {
        let i = t[++r];
        e2 += i === "'" ? "'" : "\\" + i;
        continue;
      }
      if (o === "'") {
        e2 += '"', n = null;
        continue;
      }
      e2 += o === '"' ? '\\"' : o;
      continue;
    }
    if (o === '"') {
      n = '"', e2 += o;
      continue;
    }
    if (o === "'") {
      n = "'", e2 += '"';
      continue;
    }
    e2 += o;
  }
  return e2;
}
function Ps(t) {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Ds(t, e2) {
  let n = 0, r = null;
  for (let o = e2; o < t.length; o++) {
    let i = t[o];
    if (r) {
      if (i === "\\") {
        o++;
        continue;
      }
      i === r && (r = null);
      continue;
    }
    if (i === '"' || i === "'") {
      r = i;
      continue;
    }
    if (i === "[" || i === "{" || i === "(") {
      n++;
      continue;
    }
    if (i === "]" || i === "}" || i === ")") {
      n--;
      continue;
    }
    if (i === ";" && n === 0) return o;
  }
  return t.length;
}
var _2 = { CN: "Asia/Shanghai", HK: "Asia/Hong_Kong", US: "America/New_York" };
function bs(t) {
  if (!t) return null;
  let e2 = t.trim();
  if (!e2) return null;
  let n = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(e2);
  if (n) return { year: +n[1], month: +n[2], day: +n[3], hour: +n[4], minute: +n[5], second: n[6] ? +n[6] : 0 };
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e2);
  return r ? { year: +r[1], month: +r[2], day: +r[3], hour: 0, minute: 0, second: 0 } : /^\d{14}$/.test(e2) ? { year: +e2.slice(0, 4), month: +e2.slice(4, 6), day: +e2.slice(6, 8), hour: +e2.slice(8, 10), minute: +e2.slice(10, 12), second: +e2.slice(12, 14) } : /^\d{8}$/.test(e2) ? { year: +e2.slice(0, 4), month: +e2.slice(4, 6), day: +e2.slice(6, 8), hour: 0, minute: 0, second: 0 } : null;
}
var Is = { wallParts: { locale: "en-US", keyPrefix: "en-US|", options: { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" } }, svDisplay: { locale: "sv-SE", keyPrefix: "sv-SE|", options: { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" } }, dateOnly: { locale: "en-CA", keyPrefix: "en-CA|", options: { year: "numeric", month: "2-digit", day: "2-digit" } } };
var Mr = /* @__PURE__ */ new Map();
function Qt(t, e2) {
  let n = Is[t], r = n.keyPrefix + e2, o = Mr.get(r);
  return o || (o = new Intl.DateTimeFormat(n.locale, { timeZone: e2, ...n.options }), Mr.set(r, o)), o;
}
function Ie(t, e2) {
  let r = Qt("wallParts", e2).formatToParts(new Date(t)), o = {};
  for (let s3 of r) s3.type !== "literal" && (o[s3.type] = s3.value);
  let i = parseInt(o.hour ?? "0", 10);
  return i === 24 && (i = 0), Date.UTC(parseInt(o.year ?? "0", 10), parseInt(o.month ?? "1", 10) - 1, parseInt(o.day ?? "1", 10), i, parseInt(o.minute ?? "0", 10), parseInt(o.second ?? "0", 10));
}
var Lr = /* @__PURE__ */ new Map();
function wr(t, e2) {
  return Ie(t, e2) - t;
}
function Ns(t, e2) {
  let n = `${t}|${e2}`, r = Lr.get(n);
  if (r === void 0) {
    let o = wr(Date.UTC(e2, 0, 1, 12), t);
    for (let i = 1; i < 12; i++) if (wr(Date.UTC(e2, i, 1, 12), t) !== o) {
      o = null;
      break;
    }
    r = o, Lr.set(n, r);
  }
  return r;
}
function Fr(t, e2) {
  if (!(t.month === 1 && t.day <= 2 || t.month === 12 && t.day >= 30)) {
    let s3 = Ns(e2, t.year);
    if (s3 !== null) return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second) - s3;
  }
  let r = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second), o = 2 * r - Ie(r, e2);
  if (Ie(o, e2) === r) return o;
  let i = r - Ie(o, e2) + o;
  return Ie(i, e2) === r ? i : o;
}
function ks(t, e2) {
  let n = (t || "").trim(), r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(n) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(n);
  if (!r) return null;
  let o = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec((e2 || "").trim());
  return o ? { year: +r[1], month: +r[2], day: +r[3], hour: +o[1], minute: +o[2], second: o[3] ? +o[3] : 0 } : null;
}
function Ee(t, e2) {
  let n = bs(t);
  return n ? Fr(n, e2) : NaN;
}
function me(t) {
  return Number.isNaN(t) ? null : t;
}
function N3(t, e2) {
  return { timestamp: me(Ee(t, e2)), tz: e2 };
}
function B2(t, e2) {
  let [n, r, o] = t.split("-").map(Number);
  return new Date(Date.UTC(n, r - 1, o + e2)).toISOString().slice(0, 10);
}
function Gt(t, e2, n) {
  let r = ks(t, e2);
  return r ? { timestamp: me(Fr(r, n)), tz: n } : { timestamp: null, tz: n };
}
function Ne(t, e2) {
  if (t == null || !Number.isFinite(t)) return "";
  let n = Qt("svDisplay", e2).format(new Date(t)), r = n.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (!r) return n;
  let o = r[2] === "24" ? "00" : r[2];
  return `${r[1]} ${o}:${r[3]}`;
}
function H3(t, e2 = Date.now()) {
  return Qt("dateOnly", t).format(new Date(e2));
}
var Wt = "https://qt.gtimg.cn";
var Vt = "https://web.ifzq.gtimg.cn/appstock/app/minute/query";
var Zt = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
var Xt = "https://ifzq.gtimg.cn/appstock/app/kline/mkline";
var Jt = "https://assets.linkdiary.cn/shares/zh_a_list.json";
var en = "https://assets.linkdiary.cn/shares/us_list.json";
var tn = "https://assets.linkdiary.cn/shares/hk_list.json";
var ct = "https://assets.linkdiary.cn/shares/fund_list";
var nn = "https://assets.linkdiary.cn/shares/trade-data-list.txt";
var ke = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
var rn = "https://push2his.eastmoney.com/api/qt/stock/trends2/get";
var dt = "https://33.push2his.eastmoney.com/api/qt/stock/kline/get";
var Me = "https://63.push2his.eastmoney.com/api/qt/stock/kline/get";
var on = "https://33.push2his.eastmoney.com/api/qt/stock/trends2/get";
var sn = "https://63.push2his.eastmoney.com/api/qt/stock/trends2/get";
var an = "https://17.push2.eastmoney.com/api/qt/clist/get";
var un = "https://91.push2.eastmoney.com/api/qt/stock/get";
var ln = "https://29.push2.eastmoney.com/api/qt/clist/get";
var cn = "https://7.push2his.eastmoney.com/api/qt/stock/kline/get";
var dn = "https://push2his.eastmoney.com/api/qt/stock/trends2/get";
var pn = "https://79.push2.eastmoney.com/api/qt/clist/get";
var mn = "https://91.push2.eastmoney.com/api/qt/stock/get";
var gn = "https://29.push2.eastmoney.com/api/qt/clist/get";
var fn = "https://91.push2his.eastmoney.com/api/qt/stock/kline/get";
var yn = "https://push2his.eastmoney.com/api/qt/stock/trends2/get";
var hn = "https://datacenter-web.eastmoney.com/api/data/v1/get";
var Le = "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get";
var Tn = "https://push2delay.eastmoney.com/api/qt/stock/get";
var Sn = "https://push2.eastmoney.com/api/qt/clist/get";
var Rn = "https://push2.eastmoney.com/api/qt/kamtbs.rtmin/get";
var _e = "https://push2ex.eastmoney.com";
var U3 = "7eea3edcaed734bea9cbfc24409ed989";
var X2 = "b2884a393a59ad64002292a3e90d46a5";
var we = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
var En = "https://futsseapi.eastmoney.com/list/COMEX,NYMEX,COBOT,SGX,NYBOT,LME,MDEX,TOCOM,IPE";
var Fe = "58b2fa8f54638b60b87d69b31969089c";
var _n = { SHFE: 113, DCE: 114, CZCE: 115, INE: 142, CFFEX: 220, GFEX: 225 };
var Ce = { cu: "SHFE", al: "SHFE", zn: "SHFE", pb: "SHFE", au: "SHFE", ag: "SHFE", rb: "SHFE", wr: "SHFE", fu: "SHFE", ru: "SHFE", bu: "SHFE", hc: "SHFE", ni: "SHFE", sn: "SHFE", sp: "SHFE", ss: "SHFE", ao: "SHFE", br: "SHFE", c: "DCE", a: "DCE", b: "DCE", m: "DCE", y: "DCE", p: "DCE", l: "DCE", v: "DCE", j: "DCE", jm: "DCE", i: "DCE", jd: "DCE", pp: "DCE", cs: "DCE", eg: "DCE", eb: "DCE", pg: "DCE", lh: "DCE", WH: "CZCE", CF: "CZCE", SR: "CZCE", TA: "CZCE", OI: "CZCE", MA: "CZCE", FG: "CZCE", RM: "CZCE", SF: "CZCE", SM: "CZCE", ZC: "CZCE", AP: "CZCE", CJ: "CZCE", UR: "CZCE", SA: "CZCE", PF: "CZCE", PK: "CZCE", PX: "CZCE", SH: "CZCE", sc: "INE", nr: "INE", lu: "INE", bc: "INE", ec: "INE", IF: "CFFEX", IC: "CFFEX", IH: "CFFEX", IM: "CFFEX", TS: "CFFEX", TF: "CFFEX", T: "CFFEX", TL: "CFFEX", si: "GFEX", lc: "GFEX", ps: "GFEX", pt: "GFEX", pd: "GFEX" };
var pt = { HG: 101, GC: 101, SI: 101, QI: 101, QO: 101, MGC: 101, CL: 102, NG: 102, RB: 102, HO: 102, PA: 102, PL: 102, ZW: 103, ZM: 103, ZS: 103, ZC: 103, ZL: 103, ZR: 103, YM: 103, NQ: 103, ES: 103, SB: 108, CT: 108, LCPT: 109, LZNT: 109, LALT: 109 };
var ge2 = "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";
var Cn = "https://quotes.sina.cn/cn/api/jsonp_v2.php/{callback}/CN_MarketDataService.getKLineData";
var Ue = "https://stock.finance.sina.com.cn/futures/api/openapi.php/OptionService.getOptionData";
var ve = "https://stock.finance.sina.com.cn/futures/api/jsonp.php/{callback}/FutureOptionAllService.getOptionDayline";
var An = "https://stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionService.getStockName";
var mt = "https://stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionService.getRemainderDay";
var On = "https://stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionDaylineService.getOptionMinline";
var Pn = "https://stock.finance.sina.com.cn/futures/api/jsonp_v2.php/{callback}/StockOptionDaylineService.getSymbolInfo";
var Dn = "https://stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionDaylineService.getFiveDayLine";
var bn = "https://futsseapi.eastmoney.com/list/option/221";
var In = "https://datacenter-web.eastmoney.com/api/data/get";
var gt = { au: { product: "au_o", exchange: "shfe" }, ag: { product: "ag_o", exchange: "shfe" }, cu: { product: "cu_o", exchange: "shfe" }, al: { product: "al_o", exchange: "shfe" }, zn: { product: "zn_o", exchange: "shfe" }, ru: { product: "ru_o", exchange: "shfe" }, sc: { product: "sc_o", exchange: "ine" }, m: { product: "m_o", exchange: "dce" }, c: { product: "c_o", exchange: "dce" }, i: { product: "i_o", exchange: "dce" }, p: { product: "p_o", exchange: "dce" }, pp: { product: "pp_o", exchange: "dce" }, l: { product: "l_o", exchange: "dce" }, v: { product: "v_o", exchange: "dce" }, pg: { product: "pg_o", exchange: "dce" }, y: { product: "y_o", exchange: "dce" }, a: { product: "a_o", exchange: "dce" }, b: { product: "b_o", exchange: "dce" }, eg: { product: "eg_o", exchange: "dce" }, eb: { product: "eb_o", exchange: "dce" }, SR: { product: "SR_o", exchange: "czce" }, CF: { product: "CF_o", exchange: "czce" }, TA: { product: "TA_o", exchange: "czce" }, MA: { product: "MA_o", exchange: "czce" }, RM: { product: "RM_o", exchange: "czce" }, OI: { product: "OI_o", exchange: "czce" }, PK: { product: "PK_o", exchange: "czce" }, PF: { product: "PF_o", exchange: "czce" }, SA: { product: "SA_o", exchange: "czce" }, UR: { product: "UR_o", exchange: "czce" } };
var Nn = 3e4;
var Ke = 500;
var xe = 500;
var Be = 7;
var kn = 3;
var Mn = 1e3;
var Ln = 3e4;
var wn = 2;
var Fn = [408, 429, 500, 502, 503, 504];
var ft = class {
  constructor(e2 = {}) {
    this.acquireChain = Promise.resolve();
    let n = e2.requestsPerSecond ?? 5;
    this.maxTokens = e2.maxBurst ?? n, this.tokens = this.maxTokens, this.refillRate = n / 1e3, this.lastRefillTime = Date.now();
  }
  refill() {
    let e2 = Date.now(), r = (e2 - this.lastRefillTime) * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + r), this.lastRefillTime = e2;
  }
  tryAcquire() {
    return this.refill(), this.tokens >= 1 ? (this.tokens -= 1, true) : false;
  }
  getWaitTime() {
    if (this.refill(), this.tokens >= 1) return 0;
    let e2 = 1 - this.tokens;
    return Math.ceil(e2 / this.refillRate);
  }
  async acquire() {
    let e2 = this.acquireChain, n;
    this.acquireChain = new Promise((r) => {
      n = r;
    });
    try {
      await e2;
      let r = this.getWaitTime();
      r > 0 && await this.sleep(r), this.refill(), this.tokens -= 1;
    } finally {
      n();
    }
  }
  sleep(e2) {
    return new Promise((n) => setTimeout(n, e2));
  }
  getAvailableTokens() {
    return this.refill(), this.tokens;
  }
};
var Ur = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0"];
var Un = 0;
function Ms() {
  return typeof window < "u" && typeof window.document < "u";
}
function vr() {
  if (Ms()) return;
  let t = Ur[Un];
  return Un = (Un + 1) % Ur.length, t;
}
var Ae = class extends s {
  constructor(e2 = "Circuit breaker is OPEN") {
    super({ code: "CIRCUIT_OPEN", message: e2 }), this.name = "CircuitBreakerError";
  }
};
var yt = class {
  constructor(e2 = {}) {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenSuccessCount = 0;
    this.halfOpenProbeStartedAt = [];
    this.failureThreshold = e2.failureThreshold ?? 5, this.resetTimeout = e2.resetTimeout ?? 3e4, this.halfOpenRequests = e2.halfOpenRequests ?? 1, this.probeRecycleTimeout = e2.probeRecycleTimeout ?? Math.max(this.resetTimeout * 4, 12e4), this.onStateChange = e2.onStateChange;
  }
  getState() {
    return this.checkStateTransition(), this.state;
  }
  canRequest() {
    switch (this.checkStateTransition(), this.state) {
      case "CLOSED":
        return true;
      case "OPEN":
        return false;
      case "HALF_OPEN": {
        let e2 = Date.now();
        for (; this.halfOpenProbeStartedAt.length > 0 && e2 - this.halfOpenProbeStartedAt[0] >= this.probeRecycleTimeout; ) this.halfOpenProbeStartedAt.shift();
        return this.halfOpenProbeStartedAt.length + this.halfOpenSuccessCount >= this.halfOpenRequests ? false : (this.halfOpenProbeStartedAt.push(e2), true);
      }
    }
  }
  releaseProbe() {
    this.state === "HALF_OPEN" && this.halfOpenProbeStartedAt.shift();
  }
  recordSuccess() {
    this.checkStateTransition(), this.state === "HALF_OPEN" ? (this.halfOpenProbeStartedAt.shift(), this.halfOpenSuccessCount++, this.halfOpenSuccessCount >= this.halfOpenRequests && this.transitionTo("CLOSED")) : this.state === "CLOSED" && (this.failureCount = 0);
  }
  recordFailure() {
    this.lastFailureTime = Date.now(), this.state === "HALF_OPEN" ? (this.halfOpenProbeStartedAt.shift(), this.transitionTo("OPEN")) : this.state === "CLOSED" && (this.failureCount++, this.failureCount >= this.failureThreshold && this.transitionTo("OPEN"));
  }
  checkStateTransition() {
    this.state === "OPEN" && Date.now() - this.lastFailureTime >= this.resetTimeout && this.transitionTo("HALF_OPEN");
  }
  transitionTo(e2) {
    if (this.state === e2) return;
    let n = this.state;
    this.state = e2, e2 === "CLOSED" ? (this.failureCount = 0, this.halfOpenSuccessCount = 0, this.halfOpenProbeStartedAt = []) : e2 === "HALF_OPEN" && (this.halfOpenSuccessCount = 0, this.halfOpenProbeStartedAt = []), this.onStateChange?.(n, e2);
  }
  reset() {
    this.transitionTo("CLOSED"), this.failureCount = 0, this.halfOpenSuccessCount = 0, this.halfOpenProbeStartedAt = [], this.lastFailureTime = 0;
  }
  async execute(e2) {
    if (!this.canRequest()) throw new Ae();
    try {
      let n = await e2();
      return this.recordSuccess(), n;
    } catch (n) {
      throw this.recordFailure(), n;
    }
  }
  getStats() {
    return { state: this.getState(), failureCount: this.failureCount, lastFailureTime: this.lastFailureTime, halfOpenSuccessCount: this.halfOpenSuccessCount };
  }
};
var Ls = 3e4;
var ws = 1;
var Kr = ["push2his.eastmoney.com", "7.push2his.eastmoney.com", "33.push2his.eastmoney.com", "63.push2his.eastmoney.com", "91.push2his.eastmoney.com"];
var xr = ["17.push2.eastmoney.com", "29.push2.eastmoney.com", "79.push2.eastmoney.com", "91.push2.eastmoney.com", "push2delay.eastmoney.com"];
function Fs(t, e2) {
  return e2 !== "eastmoney" ? [t] : t.includes("push2his.eastmoney.com") ? Kr : t.includes("push2.eastmoney.com") ? xr : [t];
}
function Us(t) {
  return Array.from(new Set(t));
}
var ht = class {
  constructor(e2 = Ls, n = ws) {
    this.cooldownMs = e2;
    this.failureThreshold = n;
    this.states = /* @__PURE__ */ new Map();
  }
  getCandidateUrls(e2, n) {
    let r;
    try {
      r = new URL(e2);
    } catch {
      return [e2];
    }
    let o = Date.now(), i = Fs(r.hostname, n);
    if (i.length <= 1) return [e2];
    let s3 = i.filter((l4) => {
      let d6 = this.states.get(l4);
      return !d6 || d6.cooldownUntil <= o;
    }), a3 = i.filter((l4) => {
      let d6 = this.states.get(l4);
      return d6 && d6.cooldownUntil > o;
    });
    return Us([...s3.includes(r.hostname) ? [r.hostname] : [], ...s3.filter((l4) => l4 !== r.hostname), ...a3.includes(r.hostname) ? [r.hostname] : [], ...a3.filter((l4) => l4 !== r.hostname)]).map((l4) => {
      let d6 = new URL(e2);
      return d6.hostname = l4, d6.toString();
    });
  }
  recordSuccess(e2) {
    let n = this.safeGetHost(e2);
    if (!n) return;
    let r = this.getState(n);
    r.failureCount = 0, r.cooldownUntil = 0, r.successCount++, r.lastErrorCode = void 0;
  }
  recordFailure(e2, n) {
    let r = this.safeGetHost(e2);
    if (!r) return;
    let o = this.getState(r);
    o.failureCount++, o.lastFailureAt = Date.now(), o.lastErrorCode = O(n), o.failureCount >= this.failureThreshold && (o.cooldownUntil = Date.now() + this.cooldownMs);
  }
  shouldFallback(e2) {
    let n = O(e2);
    return n === "NETWORK_ERROR" || n === "TIMEOUT" || n === "PARSE_ERROR" ? true : e2 instanceof u ? e2.status === 408 || e2.status === 429 || e2.status >= 500 : false;
  }
  getStats(e2) {
    let n = Array.from(this.states.values()).map((o) => ({ ...o }));
    if (!e2) return n;
    if (e2 !== "eastmoney") return [];
    let r = /* @__PURE__ */ new Set([...Kr, ...xr]);
    return n.filter((o) => r.has(o.host));
  }
  safeGetHost(e2) {
    try {
      return new URL(e2).hostname;
    } catch {
      return null;
    }
  }
  getState(e2) {
    let n = this.states.get(e2);
    if (n) return n;
    let r = { host: e2, failureCount: 0, successCount: 0, cooldownUntil: 0, lastFailureAt: 0 };
    return this.states.set(e2, r), r;
  }
};
function vn(t) {
  return { maxRetries: t?.maxRetries ?? kn, baseDelay: t?.baseDelay ?? Mn, maxDelay: t?.maxDelay ?? Ln, backoffMultiplier: t?.backoffMultiplier ?? wn, retryableStatusCodes: t?.retryableStatusCodes ?? Fn, retryOnNetworkError: t?.retryOnNetworkError ?? true, retryOnTimeout: t?.retryOnTimeout ?? true, onRetry: t?.onRetry };
}
function vs(t, e2) {
  let n = { ...t ?? {} };
  return e2 && (Object.keys(n).some((o) => o.toLowerCase() === "user-agent") || (n["User-Agent"] = e2)), n;
}
function Br(t, e2) {
  return e2 ? { timeout: e2.timeout ?? t.timeout, retry: e2.retry ? { ...t.retry ?? {}, ...e2.retry } : t.retry ? { ...t.retry } : void 0, headers: { ...t.headers ?? {}, ...e2.headers ?? {} }, userAgent: e2.userAgent ?? t.userAgent, rateLimit: e2.rateLimit ? { ...t.rateLimit ?? {}, ...e2.rateLimit } : t.rateLimit ? { ...t.rateLimit } : void 0, rotateUserAgent: e2.rotateUserAgent ?? t.rotateUserAgent, circuitBreaker: e2.circuitBreaker ? { ...t.circuitBreaker ?? {}, ...e2.circuitBreaker } : t.circuitBreaker ? { ...t.circuitBreaker } : void 0 } : { ...t, headers: { ...t.headers ?? {} }, retry: t.retry ? { ...t.retry } : void 0, rateLimit: t.rateLimit ? { ...t.rateLimit } : void 0, circuitBreaker: t.circuitBreaker ? { ...t.circuitBreaker } : void 0 };
}
function Kn(t = {}) {
  return { timeout: t.timeout ?? Nn, retry: vn(t.retry), headers: vs(t.headers, t.userAgent), rotateUserAgent: t.rotateUserAgent ?? false, rateLimit: t.rateLimit ? { ...t.rateLimit } : void 0, circuitBreaker: t.circuitBreaker ? { ...t.circuitBreaker } : void 0 };
}
function Hr(t, e2) {
  if (e2) return e2;
  try {
    let n = new URL(t).hostname;
    if (n.includes("eastmoney.com")) return "eastmoney";
    if (n.includes("gtimg.cn")) return "tencent";
    if (n.includes("sina.com.cn")) return "sina";
    if (n.includes("linkdiary.cn")) return "linkdiary";
  } catch {
    return "unknown";
  }
  return "unknown";
}
function qr(t) {
  if (t instanceof DOMException && t.name === "AbortError") return true;
  if (t instanceof Error) {
    if (t.name === "AbortError") return true;
    let e2 = t.cause;
    if ((e2 instanceof Error || e2 instanceof DOMException) && e2.name === "AbortError") return true;
  }
  return false;
}
var xn = () => {
};
function Ks(t) {
  let e2 = t.filter((a3) => !!a3);
  if (e2.length === 0) return { signal: void 0, cleanup: xn };
  if (e2.length === 1) return { signal: e2[0], cleanup: xn };
  let n = AbortSignal.any;
  if (typeof n == "function") return { signal: n(e2), cleanup: xn };
  let r = new AbortController(), o = (a3) => {
    r.signal.aborted || r.abort(a3);
  }, i = [];
  for (let a3 of e2) {
    if (a3.aborted) {
      o(a3.reason);
      break;
    }
    let c2 = () => o(a3.reason);
    a3.addEventListener("abort", c2, { once: true }), i.push({ s: a3, handler: c2 });
  }
  let s3 = () => {
    for (let { s: a3, handler: c2 } of i) a3.removeEventListener("abort", c2);
  };
  return { signal: r.signal, cleanup: s3 };
}
async function xs(t, e2) {
  if (!t) return e2;
  if (Promise.resolve(e2).catch(() => {
  }), t.aborted) return Promise.race([e2, Promise.reject(t.reason)]);
  let n, r = new Promise((o, i) => {
    n = () => i(t.reason), t.addEventListener("abort", n, { once: true });
  });
  try {
    return await Promise.race([e2, r]);
  } finally {
    t.removeEventListener("abort", n);
  }
}
var He = class {
  constructor(e2 = {}) {
    this.baseUrl = e2.baseUrl ?? Wt;
    let n = { timeout: e2.timeout, retry: e2.retry, headers: e2.headers, userAgent: e2.userAgent, rateLimit: e2.rateLimit, rotateUserAgent: e2.rotateUserAgent, circuitBreaker: e2.circuitBreaker };
    this.defaultPolicy = Kn(n), this.providerPolicies = {}, this.runtimeStates = /* @__PURE__ */ new Map(), this.fallbackManager = new ht(), this.fetchImpl = e2.fetchImpl, this.clientSignal = e2.signal, this.hooks = e2.hooks;
    for (let [r, o] of Object.entries(e2.providerPolicies ?? {})) {
      let i = Br(n, o);
      this.providerPolicies[r] = Kn(i);
    }
  }
  getProviderState(e2) {
    let n = this.runtimeStates.get(e2);
    if (n) return n;
    let r = this.providerPolicies[e2] ?? this.defaultPolicy, o = { policy: r, rateLimiter: r.rateLimit ? new ft(r.rateLimit) : null, circuitBreaker: r.circuitBreaker ? new yt(r.circuitBreaker) : null };
    return this.runtimeStates.set(e2, o), o;
  }
  getTimeout() {
    return this.defaultPolicy.timeout;
  }
  getHostHealth(e2) {
    return this.fallbackManager.getStats(e2);
  }
  safe(e2) {
    try {
      e2();
    } catch {
    }
  }
  toSdkError(e2) {
    return e2 instanceof s ? e2 : new s({ code: O(e2) ?? "NETWORK_ERROR", message: e2.message, provider: e2.provider, url: e2.url, status: e2.status, details: e2.details, cause: e2 });
  }
  calculateDelay(e2, n) {
    return Math.min(n.baseDelay * Math.pow(n.backoffMultiplier, e2), n.maxDelay) + Math.random() * 100;
  }
  sleep(e2) {
    return new Promise((n) => setTimeout(n, e2));
  }
  shouldRetry(e2, n, r) {
    if (n >= r.maxRetries) return false;
    let o = O(e2);
    return o === "ABORTED" ? false : o === "TIMEOUT" ? r.retryOnTimeout : o === "NETWORK_ERROR" ? r.retryOnNetworkError : e2 instanceof u ? r.retryableStatusCodes.includes(e2.status) : false;
  }
  async executeWithRetry(e2, n, r, o = 0) {
    try {
      return await e2(o);
    } catch (i) {
      let s3 = g(i, r), a3 = { provider: r.provider, url: r.url, timeout: r.timeout, attempt: o, responseType: r.responseType };
      if (this.safe(() => this.hooks?.onError?.(a3, this.toSdkError(s3))), this.safe(() => this.hooks?.trace?.("error", a3)), this.shouldRetry(s3, o, n)) {
        let c2 = this.calculateDelay(o, n);
        return n.onRetry && n.onRetry(o + 1, s3, c2), this.safe(() => this.hooks?.onRetry?.(a3, this.toSdkError(s3), c2)), this.safe(() => this.hooks?.trace?.("retry", a3)), await this.sleep(c2), this.executeWithRetry(e2, n, r, o + 1);
      }
      throw s3;
    }
  }
  async performRequest(e2, n, r, o = "text", i = {}, s3 = 0) {
    n.rateLimiter && await n.rateLimiter.acquire();
    let a3 = new AbortController(), c2 = new DOMException(`Request timed out after ${n.policy.timeout}ms`, "AbortError"), l4 = setTimeout(() => a3.abort(c2), n.policy.timeout), { signal: d6, cleanup: p3 } = Ks([a3.signal, i.signal, this.clientSignal]), g2 = i.fetchImpl ?? this.fetchImpl ?? globalThis.fetch, m2 = { ...n.policy.headers };
    if (n.policy.rotateUserAgent) {
      let h3 = vr();
      if (h3) {
        for (let C of Object.keys(m2)) C.toLowerCase() === "user-agent" && delete m2[C];
        m2["User-Agent"] = h3;
      }
    }
    let f3 = { provider: r, url: e2, timeout: n.policy.timeout, attempt: s3, responseType: o };
    this.safe(() => this.hooks?.onRequest?.(f3)), this.safe(() => this.hooks?.trace?.("request", f3));
    let T3 = Date.now();
    try {
      let h3 = await xs(d6, g2(e2, { signal: d6, headers: m2 }));
      if (this.safe(() => this.hooks?.onResponse?.(f3, { status: h3.status, durationMs: Date.now() - T3 })), this.safe(() => this.hooks?.trace?.("response", f3)), !h3.ok) throw new u(h3.status, h3.statusText, e2, r);
      switch (o) {
        case "json":
          try {
            return await h3.json();
          } catch (C) {
            throw new s({ code: "PARSE_ERROR", message: `Failed to parse JSON response from ${e2}`, provider: r, url: e2, cause: C });
          }
        case "arraybuffer":
          return await h3.arrayBuffer();
        default:
          return await h3.text();
      }
    } catch (h3) {
      let C = (O2) => O2?.aborted ? h3 === O2.reason ? true : h3 instanceof Error && h3.cause === O2.reason : false;
      if (!C(a3.signal)) {
        let O2 = i.signal?.aborted || this.clientSignal?.aborted;
        if (C(i.signal) || C(this.clientSignal) || O2 && qr(h3)) throw new p("Request aborted by external signal", r, e2);
        if (a3.signal.aborted && qr(h3)) throw c2;
      }
      throw h3;
    } finally {
      clearTimeout(l4), p3();
    }
  }
  async get(e2, n = {}) {
    let r = Hr(e2, n.provider), o = this.getProviderState(r);
    if (o.circuitBreaker && !o.circuitBreaker.canRequest()) throw new Ae("Circuit breaker is OPEN, request rejected");
    let i = { fetchImpl: n.fetchImpl, signal: n.signal }, s3 = n.retry ? vn({ ...o.policy.retry, ...n.retry }) : o.policy.retry, a3 = n.hostFallback === false ? [e2] : this.fallbackManager.getCandidateUrls(e2, r), c2;
    for (let l4 = 0; l4 < a3.length; l4++) {
      let d6 = a3[l4], p3 = l4 === 0 ? s3 : { ...s3, maxRetries: 0 };
      try {
        let g2 = await this.executeWithRetry((m2) => this.performRequest(d6, o, r, n.responseType, i, m2), p3, { provider: r, url: d6, timeout: o.policy.timeout, responseType: n.responseType });
        return o.circuitBreaker?.recordSuccess(), this.fallbackManager.recordSuccess(d6), g2;
      } catch (g2) {
        let m2 = g(g2, { provider: r, url: d6, timeout: o.policy.timeout });
        c2 = m2;
        let f3 = O(m2) === "ABORTED";
        if (f3 ? o.circuitBreaker?.releaseProbe() : this.fallbackManager.recordFailure(d6, m2), l4 < a3.length - 1 && this.fallbackManager.shouldFallback(m2)) {
          this.safe(() => this.hooks?.trace?.("fallback", { provider: r, url: d6, timeout: o.policy.timeout, attempt: 0, responseType: n.responseType }));
          continue;
        }
        throw f3 || o.circuitBreaker?.recordFailure(), this.toSdkError(m2);
      }
    }
    throw o.circuitBreaker?.recordFailure(), c2 ? this.toSdkError(c2) : new Ae("Request failed without a concrete error");
  }
  async getTencentQuote(e2) {
    let n = `${this.baseUrl}/?q=${encodeURIComponent(e2)}`, r = await this.get(n, { responseType: "arraybuffer", provider: "tencent" }), o = qt(r);
    return $t(o);
  }
};
var q3 = (t, e2) => t * 60 + e2;
var Bs = { A: { tz: _2.CN, open: [[q3(9, 30), q3(11, 30)], [q3(13, 0), q3(15, 0)]], lunchBreak: [q3(11, 30), q3(13, 0)], tradingWeekdays: [1, 2, 3, 4, 5] }, HK: { tz: _2.HK, open: [[q3(9, 30), q3(12, 0)], [q3(13, 0), q3(16, 0)]], lunchBreak: [q3(12, 0), q3(13, 0)], tradingWeekdays: [1, 2, 3, 4, 5] }, US: { tz: _2.US, open: [[q3(9, 30), q3(16, 0)]], tradingWeekdays: [1, 2, 3, 4, 5] } };
function Bn(t, e2) {
  if (t == null) return H3(e2);
  if (t instanceof Date) return H3(e2, t.getTime());
  let n = t.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) return n;
  if (/^\d{8}$/.test(n)) return `${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 8)}`;
  let r = new Date(n);
  if (!Number.isNaN(r.getTime())) return H3(e2, r.getTime());
  throw new c(`Unsupported date input: ${JSON.stringify(t)}. Expected 'YYYY-MM-DD', 'YYYYMMDD', or Date.`);
}
function Hs(t, e2) {
  let n = new Intl.DateTimeFormat("en-US", { timeZone: e2, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" }), r = {};
  for (let c2 of n.formatToParts(t)) c2.type !== "literal" && (r[c2.type] = c2.value);
  let o = parseInt(r.hour ?? "0", 10);
  o === 24 && (o = 0);
  let i = parseInt(r.minute ?? "0", 10), a3 = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[r.weekday ?? ""] ?? 0;
  return { minutes: o * 60 + i, weekday: a3 };
}
function Hn(t, e2) {
  let n = 0, r = t.length;
  for (; n < r; ) {
    let o = n + r >>> 1;
    t[o] < e2 ? n = o + 1 : r = o;
  }
  return n;
}
var qe = class {
  constructor(e2) {
    this.quoteService = e2;
  }
  async isTradingDay(e2) {
    let n = Bn(e2, _2.CN), r = await this.quoteService.getTradingCalendar(), o = Hn(r, n);
    return o < r.length && r[o] === n;
  }
  async nextTradingDay(e2) {
    let n = Bn(e2, _2.CN), r = await this.quoteService.getTradingCalendar(), o = Hn(r, n);
    if (o < r.length && r[o] === n && (o += 1), o >= r.length) throw new c(`nextTradingDay: ${n} \u4E4B\u540E\u6CA1\u6709\u53EF\u7528\u4EA4\u6613\u65E5 (\u65E5\u5386\u6700\u5927\u65E5\u671F ${r[r.length - 1] ?? "N/A"})`);
    return r[o];
  }
  async prevTradingDay(e2) {
    let n = Bn(e2, _2.CN), r = await this.quoteService.getTradingCalendar(), i = Hn(r, n) - 1;
    if (i < 0) throw new c(`prevTradingDay: ${n} \u4E4B\u524D\u6CA1\u6709\u53EF\u7528\u4EA4\u6613\u65E5 (\u65E5\u5386\u6700\u5C0F\u65E5\u671F ${r[0] ?? "N/A"})`);
    return r[i];
  }
  getMarketStatus(e2 = "A", n = /* @__PURE__ */ new Date()) {
    let r = Bs[e2], { minutes: o, weekday: i } = Hs(n, r.tz);
    if (!r.tradingWeekdays.includes(i)) return "closed";
    let s3 = r.open[0][0], a3 = r.open[r.open.length - 1][1];
    if (o < s3) return "pre_market";
    if (o >= a3) return "after_hours";
    for (let [c2, l4] of r.open) if (o >= c2 && o < l4) return "open";
    return r.lunchBreak && o >= r.lunchBreak[0] && o < r.lunchBreak[1] ? "lunch_break" : "closed";
  }
};
var F4 = {};
e(F4, { FULL_QUOTE_MIN_FIELDS: () => qn, FUND_FLOW_MIN_FIELDS: () => jn, FUND_QUOTE_MIN_FIELDS: () => Yn, HK_QUOTE_MIN_FIELDS: () => Tt, PANEL_LARGE_ORDER_MIN_FIELDS: () => Qn, SIMPLE_QUOTE_MIN_FIELDS: () => $n, US_QUOTE_MIN_FIELDS: () => zn, filterTencentRows: () => $, getAShareCodeList: () => no, getAllHKQuotesByCodes: () => io, getAllQuotesByCodes: () => oo, getAllUSQuotesByCodes: () => so, getFullQuotes: () => St, getFundCodeList: () => ao, getFundFlow: () => Yr, getFundQuotes: () => Qr, getHKCodeList: () => ro, getHKQuotes: () => Rt, getPanelLargeOrder: () => jr, getSimpleQuotes: () => zr, getTencentHistoryKline: () => At, getTencentMinuteKline: () => Ot, getTodayTimeline: () => Gr, getTradingCalendar: () => uo, getUSCodeList: () => Pt, getUSQuotes: () => Et, parseFullQuote: () => Gn, parseFundFlow: () => Vn, parseFundQuote: () => er, parseHKQuote: () => Xn, parsePanelLargeOrder: () => Zn, parseSimpleQuote: () => Wn, parseUSQuote: () => Jn, search: () => co });
function $r(t, e2) {
  let n = t.replace(/^\./, ""), r = n ? E4(n) : void 0;
  return r && r.market === e2 ? { code: r.code, assetType: "index" } : { code: t, assetType: "stock" };
}
var qn = 38;
var $n = 8;
var Tt = 38;
var zn = 38;
var Yn = 9;
var jn = 14;
var Qn = 4;
function $(t, e2, n) {
  return t.filter((r) => e2.has(r.key) && r.fields && r.fields.length >= n && r.fields[0] !== "");
}
function Gn(t) {
  let e2 = [];
  for (let i = 0; i < 5; i++) e2.push({ price: R3(t[9 + i * 2]), volume: R3(t[10 + i * 2]) });
  let n = [];
  for (let i = 0; i < 5; i++) n.push({ price: R3(t[19 + i * 2]), volume: R3(t[20 + i * 2]) });
  let r = t[30] ?? "", o = N3(r, _2.CN);
  return { marketId: t[0] ?? "", name: t[1] ?? "", code: t[2] ?? "", price: R3(t[3]), prevClose: R3(t[4]), open: R3(t[5]), volume: R3(t[6]), outerVolume: R3(t[7]), innerVolume: R3(t[8]), bid: e2, ask: n, time: r, timestamp: o.timestamp, tz: o.tz, change: R3(t[31]), changePercent: R3(t[32]), high: R3(t[33]), low: R3(t[34]), volume2: R3(t[36]), amount: R3(t[37]), turnoverRate: P2(t[38]), pe: P2(t[39]), amplitude: P2(t[43]), circulatingMarketCap: P2(t[44]), totalMarketCap: P2(t[45]), pb: P2(t[46]), limitUp: P2(t[47]), limitDown: P2(t[48]), volumeRatio: P2(t[49]), avgPrice: P2(t[51]), peStatic: P2(t[52]), peDynamic: P2(t[53]), high52w: P2(t[67]), low52w: P2(t[68]), circulatingShares: P2(t[72]), totalShares: P2(t[73]), market: "CN", assetType: "stock", source: "tencent" };
}
function Wn(t) {
  return { marketId: t[0] ?? "", name: t[1] ?? "", code: t[2] ?? "", price: R3(t[3]), change: R3(t[4]), changePercent: R3(t[5]), volume: R3(t[6]), amount: R3(t[7]), marketCap: P2(t[9]), marketType: t[10] ?? "", market: "CN", assetType: "stock", source: "tencent" };
}
function Vn(t) {
  let e2 = t[13] ?? "", n = N3(e2, _2.CN);
  return { code: t[0] ?? "", mainInflow: R3(t[1]), mainOutflow: R3(t[2]), mainNet: R3(t[3]), mainNetRatio: R3(t[4]), retailInflow: R3(t[5]), retailOutflow: R3(t[6]), retailNet: R3(t[7]), retailNetRatio: R3(t[8]), totalFlow: R3(t[9]), name: t[12] ?? "", date: e2, timestamp: n.timestamp, tz: n.tz };
}
function Zn(t) {
  return { buyLargeRatio: R3(t[0]), buySmallRatio: R3(t[1]), sellLargeRatio: R3(t[2]), sellSmallRatio: R3(t[3]) };
}
function Xn(t) {
  let e2 = t[30] ?? "", n = N3(e2, _2.HK), r = $r(t[2] ?? "", "HK");
  return { marketId: t[0] ?? "", name: t[1] ?? "", code: r.code, price: R3(t[3]), prevClose: R3(t[4]), open: R3(t[5]), volume: R3(t[6]), time: e2, timestamp: n.timestamp, tz: n.tz, change: R3(t[31]), changePercent: R3(t[32]), high: R3(t[33]), low: R3(t[34]), amount: R3(t[37]), lotSize: P2(t[40]), circulatingMarketCap: P2(t[44]), totalMarketCap: P2(t[45]), currency: /^[A-Z]{3}$/.test(t[t.length - 3] ?? "") ? t[t.length - 3] : "", market: "HK", assetType: r.assetType, source: "tencent" };
}
function Jn(t) {
  let e2 = t[30] ?? "", n = N3(e2, _2.US), r = $r(t[2] ?? "", "US");
  return { marketId: t[0] ?? "", name: t[1] ?? "", code: r.code, price: R3(t[3]), prevClose: R3(t[4]), open: R3(t[5]), volume: R3(t[6]), time: e2, timestamp: n.timestamp, tz: n.tz, change: R3(t[31]), changePercent: R3(t[32]), high: R3(t[33]), low: R3(t[34]), amount: R3(t[37]), turnoverRate: P2(t[38]), pe: P2(t[39]), amplitude: P2(t[43]), totalMarketCap: P2(t[45]), pb: P2(t[47]), high52w: P2(t[48]), low52w: P2(t[49]), market: "US", assetType: r.assetType, source: "tencent" };
}
function er(t) {
  let e2 = t[8] ?? "", n = N3(e2, _2.CN);
  return { code: t[0] ?? "", name: t[1] ?? "", nav: R3(t[5]), accNav: R3(t[6]), change: R3(t[7]), navDate: e2, timestamp: n.timestamp, tz: n.tz, market: "CN", assetType: "fund", source: "tencent" };
}
async function St(t, e2) {
  if (!e2 || e2.length === 0) return [];
  let { keys: n } = W2(e2, "CN");
  if (n.length === 0) return [];
  let r = await t.getTencentQuote(n.join(",")), o = new Set(n);
  return $(r, o, qn).map((i) => Gn(i.fields));
}
async function zr(t, e2) {
  if (!e2 || e2.length === 0) return [];
  let { keys: n } = W2(e2, "CN");
  if (n.length === 0) return [];
  let r = n.map((s3) => `s_${s3}`), o = await t.getTencentQuote(r.join(",")), i = new Set(r);
  return $(o, i, $n).map((s3) => Wn(s3.fields));
}
async function Yr(t, e2) {
  if (!e2 || e2.length === 0) return [];
  let { keys: n } = W2(e2, "CN");
  if (n.length === 0) return [];
  let r = n.map((s3) => `ff_${s3}`), o = await t.getTencentQuote(r.join(",")), i = new Set(r);
  return $(o, i, jn).map((s3) => Vn(s3.fields));
}
async function jr(t, e2) {
  if (!e2 || e2.length === 0) return [];
  let { keys: n } = W2(e2, "CN");
  if (n.length === 0) return [];
  let r = n.map((s3) => `s_pk${s3}`), o = await t.getTencentQuote(r.join(",")), i = new Set(r);
  return $(o, i, Qn).map((s3) => Zn(s3.fields));
}
function qs(t) {
  return /^hk\d+$/.test(t) ? `r_${t}` : t;
}
async function Rt(t, e2) {
  if (!e2 || e2.length === 0) return [];
  let { keys: n } = W2(e2, "HK");
  if (n.length === 0) return [];
  let r = n.map(qs), o = await t.getTencentQuote(r.join(",")), i = $(o, new Set(r), Tt), s3 = new Set(i.map((c2) => c2.key)), a3 = n.filter((c2, l4) => r[l4] !== c2 && !s3.has(r[l4]));
  if (a3.length > 0) {
    let c2 = await t.getTencentQuote(a3.join(","));
    i.push(...$(c2, new Set(a3), Tt));
  }
  return i.map((c2) => Xn(c2.fields));
}
async function Et(t, e2) {
  if (!e2 || e2.length === 0) return [];
  let { keys: n } = W2(e2, "US");
  if (n.length === 0) return [];
  let r = await t.getTencentQuote(n.join(",")), o = new Set(n);
  return $(r, o, zn).map((i) => Jn(i.fields));
}
async function Qr(t, e2) {
  if (!e2 || e2.length === 0) return [];
  let n = e2.map((i) => `jj${i}`), r = await t.getTencentQuote(n.join(",")), o = new Set(n);
  return $(r, o, Yn).map((i) => er(i.fields));
}
async function Gr(t, e2) {
  let n = `${Vt}?code=${encodeURIComponent(e2)}`, r = await t.get(n, { responseType: "json", provider: "tencent" });
  if (r.code !== 0) throw new l(r.msg || "API error", "tencent", n);
  let o = r.data?.[e2];
  if (!o) {
    let g2 = N3("", _2.CN);
    return { code: e2, date: "", timestamp: g2.timestamp, tz: g2.tz, preClose: 0, data: [] };
  }
  let i = o.data?.data ?? [], s3 = o.data?.date ?? "", a3 = o.qt?.[e2] ?? [], c2 = parseFloat(a3[4] ?? "") || 0, l4 = false;
  for (let g2 of i) {
    let m2 = g2.split(" "), f3 = parseFloat(m2[1]) || 0, T3 = parseInt(m2[2], 10) || 0, h3 = parseFloat(m2[3]) || 0;
    if (T3 > 0 && f3 > 0) {
      h3 / T3 > f3 * 50 && (l4 = true);
      break;
    }
  }
  let d6 = i.map((g2) => {
    let m2 = g2.split(" "), f3 = m2[0], T3 = `${f3.slice(0, 2)}:${f3.slice(2, 4)}`, h3 = parseInt(m2[2], 10) || 0, C = parseFloat(m2[3]) || 0, O2 = l4 ? h3 * 100 : h3, w = O2 > 0 ? C / O2 : 0, ae2 = Gt(s3, T3, _2.CN);
    return { time: T3, timestamp: ae2.timestamp, tz: ae2.tz, price: parseFloat(m2[1]) || 0, volume: O2, amount: C, avgPrice: Math.round(w * 100) / 100 };
  }), p3 = N3(s3, _2.CN);
  return { code: e2, date: s3, timestamp: p3.timestamp, tz: p3.tz, preClose: c2, data: d6 };
}
var Ct = 640;
var Zr = 100;
function Xr(t) {
  return typeof t == "object" && t !== null && !Array.isArray(t);
}
function Wr(t) {
  let e2 = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  return e2 ? `${e2[1]}-${e2[2]}-${e2[3]}` : t.slice(0, 10);
}
function _t(t) {
  return Math.round(t * 100) / 100;
}
function tr(t) {
  return Math.round(t * 1e3) / 1e3;
}
function $s(t) {
  if (!Array.isArray(t)) return [];
  let e2 = [];
  for (let n of t) !Array.isArray(n) || typeof n[0] != "string" || e2.push({ date: n[0], open: u2(n[1]), close: u2(n[2]), high: u2(n[3]), low: u2(n[4]), volume: u2(n[5]) });
  return e2;
}
function zs(t) {
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}`;
}
function Ys(t) {
  if (!Array.isArray(t)) return [];
  let e2 = [];
  for (let n of t) !Array.isArray(n) || typeof n[0] != "string" || !/^\d{12}$/.test(n[0]) || e2.push({ rawTime: n[0], time: zs(n[0]), open: u2(n[1]), close: u2(n[2]), high: u2(n[3]), low: u2(n[4]), volume: u2(n[5]) });
  return e2;
}
function js(t, e2) {
  let n = t === "daily" ? "day" : t === "weekly" ? "week" : "month";
  return e2 ? `${e2}${n}` : n;
}
function Jr(t) {
  return t === "monthly" ? 45 : t === "weekly" ? 14 : 10;
}
async function eo(t, e2, n, r, o, i) {
  let s3 = n === "daily" ? "day" : n === "weekly" ? "week" : "month", a3 = new URLSearchParams({ param: [e2, s3, o, i, String(Ct), r].join(",") }), c2 = `${Zt}?${a3.toString()}`, l4 = await t.get(c2, { responseType: "json", provider: "tencent" });
  if (l4.code !== void 0 && l4.code !== 0) throw new l(`Tencent K-line request failed: ${l4.msg || `code=${l4.code}`}`, "tencent", c2, { code: l4.code });
  let d6 = l4.data?.[e2];
  if (!Xr(d6)) throw new a("Tencent K-line response has no symbol payload", "tencent", c2);
  return $s(d6[js(n, r)] ?? d6[s3]);
}
async function Qs(t, e2, n, r, o, i) {
  let s3 = /* @__PURE__ */ new Map(), a3 = i;
  for (let c2 = 0; c2 < Zr; c2++) {
    let l4 = await eo(t, e2, n, r, o, a3);
    for (let p3 of l4) s3.set(p3.date, p3);
    if (l4.length === 0) break;
    let d6 = l4[0].date;
    if (l4.length < Ct || d6 <= o) break;
    a3 = B2(d6, -1), await new Promise((p3) => setTimeout(p3, 100));
  }
  return [...s3.values()].sort((c2, l4) => c2.date.localeCompare(l4.date));
}
async function Gs(t, e2, n, r) {
  let o = [...r].reverse().find((l4) => l4.close !== null && l4.close !== 0);
  if (!o) throw new a("Tencent hfq series has no usable close for qfq rescaling", "tencent");
  let s3 = (await eo(t, e2, n, "", B2(o.date, -Jr(n)), o.date)).find((l4) => l4.date === o.date);
  if (!s3 || s3.close === null) throw new a(`Tencent unadjusted anchor missing for ${o.date}; cannot derive qfq`, "tencent");
  let a3 = s3.close / o.close, c2 = (l4) => l4 === null ? null : tr(l4 * a3);
  return r.map((l4) => ({ ...l4, open: c2(l4.open), close: c2(l4.close), high: c2(l4.high), low: c2(l4.low) }));
}
async function At(t, e2, n = {}) {
  let r = n.period ?? "daily", o = n.adjust ?? "qfq", i = Wr(n.startDate ?? "19700101"), s3 = Wr(n.endDate ?? "20500101"), a3 = B2(i, -Jr(r)), c2 = b(e2, { market: "CN" }), l4 = z2(c2), p3 = await Qs(t, l4, r, o === "qfq" ? "hfq" : o, a3, s3);
  return o === "qfq" && p3.length > 0 && (p3 = await Gs(t, l4, r, p3)), p3.map((m2, f3) => {
    let T3 = f3 > 0 ? p3[f3 - 1].close : null, h3 = m2.close !== null && T3 !== null ? tr(m2.close - T3) : null, C = h3 !== null && T3 !== 0 && T3 !== null ? _t(h3 / T3 * 100) : null, O2 = m2.high !== null && m2.low !== null && T3 !== 0 && T3 !== null ? _t((m2.high - m2.low) / T3 * 100) : null, w = N3(m2.date, _2.CN);
    return { ...m2, timestamp: w.timestamp, tz: w.tz, code: c2.code, amount: null, amplitude: O2, changePercent: C, change: h3, turnoverRate: null };
  }).filter((m2) => m2.date >= i && m2.date <= s3);
}
function Vr(t, e2) {
  let n = /^(\d{4})-?(\d{2})-?(\d{2})(?:[ T]?(\d{2}):?(\d{2}))?/.exec(t.trim());
  if (!n) return t;
  let r = n[4] ?? (e2 ? "23" : "00"), o = n[5] ?? (e2 ? "59" : "00");
  return `${n[1]}${n[2]}${n[3]}${r}${o}`;
}
async function Ws(t, e2, n, r) {
  let o = new URLSearchParams({ param: [e2, `m${n}`, r, String(Ct)].join(",") }), i = `${Xt}?${o.toString()}`, s3 = await t.get(i, { responseType: "json", provider: "tencent" });
  if (s3.code !== void 0 && s3.code !== 0) throw new l(`Tencent minute K-line request failed: ${s3.msg || `code=${s3.code}`}`, "tencent", i, { code: s3.code });
  let a3 = s3.data?.[e2];
  if (!Xr(a3)) throw new a("Tencent minute K-line response has no symbol payload", "tencent", i);
  return Ys(a3[`m${n}`]);
}
async function Ot(t, e2, n) {
  let r = b(e2, { market: "CN" }), o = z2(r), i = n.startDate ? Vr(n.startDate, false) : void 0, s3 = n.endDate ? Vr(n.endDate, true) : void 0, a3 = /* @__PURE__ */ new Map(), c2 = s3 ?? "";
  for (let p3 = 0; p3 < Zr; p3++) {
    let g2 = await Ws(t, o, n.period, c2);
    for (let f3 of g2) a3.set(f3.rawTime, f3);
    if (g2.length === 0 || i === void 0) break;
    let m2 = g2[0].rawTime;
    if (g2.length < Ct || m2 <= i) break;
    c2 = m2, await new Promise((f3) => setTimeout(f3, 100));
  }
  let l4 = [...a3.values()].sort((p3, g2) => p3.rawTime.localeCompare(g2.rawTime));
  return l4.map((p3, g2) => {
    let m2 = g2 > 0 ? l4[g2 - 1].close : null, f3 = p3.close !== null && m2 !== null ? tr(p3.close - m2) : null, T3 = f3 !== null && m2 !== 0 && m2 !== null ? _t(f3 / m2 * 100) : null, h3 = p3.high !== null && p3.low !== null && m2 !== 0 && m2 !== null ? _t((p3.high - p3.low) / m2 * 100) : null, C = N3(p3.time, _2.CN);
    return { time: p3.time, timestamp: C.timestamp, tz: C.tz, open: p3.open, close: p3.close, high: p3.high, low: p3.low, volume: p3.volume, amount: null, amplitude: h3, changePercent: T3, change: f3, turnoverRate: null };
  }).filter((p3) => {
    let g2 = p3.time.replace(/[- :]/g, "");
    return (i === void 0 || g2 >= i) && (s3 === void 0 || g2 <= s3);
  });
}
var to = { defaultTTL: 360 * 60 * 1e3, maxSize: 16 };
async function nr(t, e2, n) {
  return T(t, "tencent:code-lists", to).getOrFetch(e2, async () => {
    let o = await t.get(n, { responseType: "json" }), i = o?.list;
    if (o?.success === false || !Array.isArray(i) || i.length === 0) throw new a(`\u4EE3\u7801\u5217\u8868\u63A5\u53E3\u8FD4\u56DE\u7A7A\u6570\u636E: ${e2}`, "tencent", n);
    return i;
  });
}
function Vs(t, e2) {
  let n = t.replace(/^(sh|sz|bj)/, "");
  switch (e2) {
    case "sh":
      return n.startsWith("6");
    case "sz":
      return n.startsWith("0") || n.startsWith("3");
    case "bj":
      return n.startsWith("4") || n.startsWith("8") || n.startsWith("92");
    case "kc":
      return n.startsWith("688");
    case "cy":
      return n.startsWith("30");
    default:
      return true;
  }
}
async function no(t, e2) {
  let n = e2?.simple ?? false, r = e2?.market, i = await nr(t, "a-share:full", Jt);
  return r && (i = i.filter((s3) => Vs(s3, r))), n ? i.map((s3) => s3.replace(/^(sh|sz|bj)/, "")) : i.slice();
}
async function Pt(t, e2) {
  let n = e2?.simple ?? false, r = e2?.market, i = (await nr(t, "us:full", en)).slice();
  if (r) {
    let s3 = `${B[r]}.`;
    i = i.filter((a3) => a3.startsWith(s3));
  }
  return n ? i.map((s3) => s3.replace(/^\d{3}\./, "")) : i;
}
async function ro(t) {
  return (await nr(t, "hk:full", tn)).slice();
}
async function oo(t, e2, n = {}) {
  let { batchSize: r = Ke, concurrency: o = Be, onProgress: i } = n;
  ie(r, "batchSize"), ie(o, "concurrency");
  let s3 = Math.min(r, xe), a3 = be2(e2, s3), c2 = a3.length, l4 = 0, d6 = a3.map((g2) => async () => {
    let m2 = await St(t, g2);
    return l4++, i && i(l4, c2), m2;
  });
  return (await V2(d6, o, true)).flat();
}
async function io(t, e2, n = {}) {
  let { batchSize: r = Ke, concurrency: o = Be, onProgress: i } = n;
  ie(r, "batchSize"), ie(o, "concurrency");
  let s3 = Math.min(r, xe), a3 = be2(e2, s3), c2 = a3.length, l4 = 0, d6 = a3.map((g2) => async () => {
    let m2 = await Rt(t, g2);
    return l4++, i && i(l4, c2), m2;
  });
  return (await V2(d6, o, true)).flat();
}
async function so(t, e2, n = {}) {
  let { batchSize: r = Ke, concurrency: o = Be, onProgress: i } = n;
  ie(r, "batchSize"), ie(o, "concurrency");
  let s3 = Math.min(r, xe), a3 = be2(e2, s3), c2 = a3.length, l4 = 0, d6 = a3.map((g2) => async () => {
    let m2 = await Et(t, g2);
    return l4++, i && i(l4, c2), m2;
  });
  return (await V2(d6, o, true)).flat();
}
async function ao(t) {
  return (await T(t, "tencent:code-lists", to).getOrFetch("fund:full", async () => {
    let i = (await t.get(ct, { responseType: "text" }) ?? "").split(",").slice(1).filter((s3) => s3.trim());
    if (i.length === 0) throw new a("\u57FA\u91D1\u4EE3\u7801\u5217\u8868\u63A5\u53E3\u8FD4\u56DE\u7A7A\u6570\u636E", "tencent", ct);
    return i;
  })).slice();
}
var Zs = { defaultTTL: 720 * 60 * 1e3, maxSize: 4 };
async function uo(t) {
  return (await T(t, "tencent:trade-calendar", Zs).getOrFetch("a-share", async () => {
    let o = (await t.get(nn) ?? "").trim().split(",").map((i) => i.trim()).filter((i) => i.length > 0);
    if (o.length === 0) throw new a("\u4EA4\u6613\u65E5\u5386\u63A5\u53E3\u8FD4\u56DE\u7A7A\u6570\u636E", "tencent", nn);
    return o;
  })).slice();
}
var lo = "https://smartbox.gtimg.cn/s3/";
var Xs = "jsVars:v_hint";
function Js(t) {
  return t.replace(/\\u([0-9a-fA-F]{4})/g, (e2, n) => String.fromCharCode(parseInt(n, 16)));
}
function ea(t) {
  let e2 = t.toUpperCase();
  return e2.startsWith("QDII") || e2.startsWith("ETF") || e2.startsWith("LOF") || e2.startsWith("KJ") || e2.startsWith("JJ") || e2.includes("FUND") ? "fund" : e2.startsWith("GP") || e2.includes("STOCK") ? "stock" : e2 === "ZS" || e2.includes("INDEX") ? "index" : e2.startsWith("ZQ") || e2.includes("BOND") ? "bond" : e2.startsWith("QH") || e2.includes("FUTURE") ? "futures" : e2.startsWith("QZ") || e2.includes("OPTION") ? "option" : "other";
}
function ta(t) {
  return !t || t === "N" ? [] : t.split("^").filter(Boolean).map((n) => {
    let r = n.split("~"), o = r[0] || "", i = r[1] || "", s3 = Js(r[2] || ""), a3 = r[4] || "";
    return { code: o + i, name: s3, market: o, type: a3, category: ea(a3) };
  });
}
async function na(t) {
  let e2 = `${lo}?v=2&t=all&q=${encodeURIComponent(t)}`, n = await de2(e2, ["v_hint"], { mutexKey: Xs });
  return typeof n.v_hint == "string" ? n.v_hint : "";
}
async function ra(t, e2) {
  let n = `${lo}?v=2&t=all&q=${encodeURIComponent(e2)}`, o = (await t.get(n)).match(/v_hint="([^"]*)"/);
  return o ? o[1] : "";
}
function oa() {
  return typeof window < "u" && typeof document < "u";
}
async function co(t, e2) {
  if (!e2 || !e2.trim()) return [];
  let n;
  return oa() ? n = await na(e2) : n = await ra(t, e2), ta(n);
}
var y2 = {};
e(y2, { assertCnStockSymbol: () => Tr, extractVariety: () => pr, fetchDatacenter: () => sr, fetchDatacenterList: () => D3, getBlockTradeDailyStat: () => Gi, getBlockTradeDetail: () => Qi, getBlockTradeMarketStat: () => ji, getBoardChanges: () => vi, getCFFEXOptionQuotes: () => ui, getComexInventory: () => mi, getConceptConstituents: () => Go, getConceptKline: () => Wo, getConceptList: () => jo, getConceptMinuteKline: () => Vo, getConceptSpot: () => Qo, getDividendDetail: () => Zo, getDragonTigerBranchRank: () => $i, getDragonTigerDetail: () => Bi, getDragonTigerInstitution: () => qi, getDragonTigerStockSeatDetail: () => zi, getDragonTigerStockStats: () => Hi, getFundDividendList: () => Xo, getFundFlowRank: () => _i, getFundNavHistory: () => Jo, getFundProfile: () => ri, getFundRankHistory: () => ei, getFuturesHistoryKline: () => ii, getFuturesInventory: () => pi, getFuturesInventorySymbols: () => di, getFuturesMarketCode: () => mr, getGlobalFuturesKline: () => ai, getGlobalFuturesSpot: () => si, getHKHistoryKline: () => Do, getHKMinuteKline: () => bo, getHistoryKline: () => Oo, getHotThemes: () => Xi, getIndividualFundFlow: () => Ri, getIndividualStockChanges: () => Ui, getIndustryConstituents: () => $o, getIndustryKline: () => zo, getIndustryList: () => Ho, getIndustryMinuteKline: () => Yo, getIndustrySpot: () => qo, getMarginAccountInfo: () => Wi, getMarginTargetList: () => Vi, getMarketFundFlow: () => Ei, getMinuteKline: () => Po, getNorthboundFlowSummary: () => Di, getNorthboundHistory: () => Ii, getNorthboundHoldingRank: () => bi, getNorthboundIndividual: () => Ni, getNorthboundMinute: () => Pi, getOptionLHB: () => li, getRealtimeFundFlow: () => fi, getSectorFundFlowHistory: () => Ai, getSectorFundFlowRank: () => Ci, getStockChanges: () => Fi, getThemeFunds: () => Ji, getThemeList: () => Zi, getUSHistoryKline: () => Mo, getUSMinuteKline: () => Lo, getUnusualFluctuation: () => Ki, getZTPool: () => wi });
async function $e(t, e2, n, r) {
  let o = [], i = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  for (let s3 = t; s3 <= e2; s3 += i) {
    let a3 = [];
    for (let l4 = s3; l4 <= Math.min(s3 + i - 1, e2); l4++) a3.push(l4);
    let c2 = await V2(a3.map((l4) => () => r(l4)), i, true);
    for (let l4 of c2) if (l4 === null || (o.push(l4.value), l4.terminal)) return o;
  }
  return o;
}
function Dt(t, e2, n) {
  let { page: r, pageSize: o } = t;
  if (r == null && o == null) return null;
  let i = r == null ? 1 : Number(r);
  if (!Number.isInteger(i) || i < 1) throw new c(`${n}: page \u9700\u4E3A >= 1 \u7684\u6574\u6570\uFF08\u6536\u5230 ${String(r)}\uFF09\u3002`, { page: r });
  let s3 = o == null ? e2.defaultPageSize : Number(o);
  if (!Number.isInteger(s3) || s3 < 1 || s3 > e2.maxPageSize) throw new c(`${n}: pageSize \u9700\u4E3A 1-${e2.maxPageSize} \u7684\u6574\u6570\uFF08\u6536\u5230 ${String(o)}\uFF09\u3002`, { pageSize: o, maxPageSize: e2.maxPageSize });
  return { page: i, pageSize: s3 };
}
function b2(t) {
  return /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : t;
}
function po(t, e2) {
  let n = (i) => b2(i.replace("T", " ").trim()).slice(0, 16), r = n(t), o = n(e2);
  return o.length === 10 && (o += " 23:59"), { start: r, end: o };
}
function mo(t, e2, n = 0) {
  let r = (s3) => {
    if (!s3) return;
    let a3 = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s3.trim());
    return a3 ? `${a3[1]}${a3[2]}${a3[3]}` : void 0;
  }, o = r(t) ?? "0", i = r(e2);
  return i !== void 0 && n > 0 && (i = B2(`${i.slice(0, 4)}-${i.slice(4, 6)}-${i.slice(6, 8)}`, n).replace(/-/g, "")), { beg: o, end: i ?? "20500000" };
}
async function rr(t, e2, n, r, o = 100, i) {
  let s3 = async (f3) => {
    let T3 = new URLSearchParams({ ...n, pn: String(f3), pz: String(o), fields: r }), h3 = `${e2}?${T3.toString()}`, O2 = (await t.get(h3, { responseType: "json" }))?.data;
    return !O2 || !Array.isArray(O2.diff) ? null : { total: O2.total, diff: O2.diff };
  }, a3 = [], c2 = await s3(1);
  if (!c2 || c2.diff.length === 0) return a3;
  let l4 = c2.total ?? 0, d6 = (f3) => {
    a3.push(...f3.map((T3, h3) => i(T3, a3.length + h3 + 1)));
  };
  d6(c2.diff);
  let p3 = o > 0 ? Math.ceil(l4 / o) : 1;
  if (p3 <= 1 || a3.length >= l4) return a3;
  let g2 = await $e(2, p3, 3, async (f3) => {
    let T3 = await s3(f3);
    return !T3 || T3.diff.length === 0 ? null : { value: T3.diff };
  });
  for (let f3 of g2) d6(f3);
  if (g2.length === p3 - 1) {
    let f3 = p3 + 1;
    for (; a3.length < l4; ) {
      let T3 = await s3(f3);
      if (!T3 || T3.diff.length === 0) break;
      d6(T3.diff), f3++;
    }
  }
  return a3;
}
function Q2(t) {
  let [e2, n, r, o, i, s3, a3, c2, l4, d6, p3] = t.split(",");
  return { date: e2, open: S(n), close: S(r), high: S(o), low: S(i), volume: S(s3), amount: S(a3), amplitude: S(c2), changePercent: S(l4), change: S(d6), turnoverRate: S(p3) };
}
async function z3(t, e2, n, r = {}) {
  let o = `${e2}?${n.toString()}`, s3 = (await t.get(o, { responseType: "json", ...r }))?.data;
  return { klines: Array.isArray(s3?.klines) ? s3.klines.filter((a3) => typeof a3 == "string") : [], name: typeof s3?.name == "string" ? s3.name : void 0, code: typeof s3?.code == "string" ? s3.code : void 0, dataPresent: s3 !== null && typeof s3 == "object" };
}
function ia(t) {
  let [e2, n, r, o, i, s3, a3, c2] = t.split(",");
  return { time: e2, open: S(n), close: S(r), high: S(o), low: S(i), volume: S(s3), amount: S(a3), avgPrice: S(c2) };
}
function bt(t, e2) {
  let n = (r) => {
    let o = Ee(r, _2.CN);
    return { time: Ne(o, t) || r, timestamp: me(o) };
  };
  return { mapTrendRow: ({ time: r, ...o }, i) => ({ ...n(r), tz: t, ...o, currency: e2, code: i.code }), mapKlineRow: ({ date: r, ...o }, i) => ({ ...n(r), tz: t, ...o, currency: e2, code: i.code }) };
}
function pe2(t) {
  return async function(n, r, o = {}, i) {
    let s3 = o.period ?? t.defaultPeriod;
    De(s3), t.fqt === "option" && se(o.adjust ?? "qfq");
    let a3 = t.resolveTarget(r), c2 = t.window, l4 = (f3) => {
      if (c2.mode === "full") return f3;
      let { start: T3, end: h3 } = po(o.startDate ?? "1979-09-01 09:32:00", o.endDate ?? "2222-01-01 09:32:00");
      return f3.filter((C) => C.time >= T3 && C.time <= h3);
    };
    if (s3 === "1") {
      let f3 = new URLSearchParams({ fields1: "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13", fields2: "f51,f52,f53,f54,f55,f56,f57,f58", ...t.includeUt ? { ut: U3 } : {}, ndays: t.ndays === "option" ? String(o.ndays ?? 1) : t.ndays.fixed, iscr: "0", secid: a3.secid }), T3 = `${t.trendsUrl}?${f3.toString()}`, C = (await n.get(T3, { responseType: "json" }))?.data?.trends;
      return !Array.isArray(C) || C.length === 0 ? [] : l4(C.map((O2) => t.mapTrendRow(ia(O2), a3)));
    }
    let d6 = c2.mode === "filter" ? mo(o.startDate, o.endDate, c2.endExtraDays ?? 0) : { beg: c2.beg, end: c2.end }, p3 = new URLSearchParams({ fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61", ...t.includeUt ? { ut: U3 } : {}, klt: s3, fqt: t.fqt === "option" ? le2(o.adjust ?? "qfq") : t.fqt.fixed, secid: a3.secid, beg: d6.beg, end: d6.end, ...t.extraKlineParams ?? {} }), g2 = await z3(n, t.klineUrl, p3, i);
    if (t.requireKlineData && !g2.dataPresent) throw new a("Eastmoney minute K-line response has no data payload", "eastmoney", t.klineUrl);
    let m2 = g2.klines;
    return !Array.isArray(m2) || m2.length === 0 ? [] : l4(m2.map((f3) => t.mapKlineRow(Q2(f3), a3)));
  };
}
var go = 1e4;
var fo = 5e3;
var sa = 1023;
function So() {
  return typeof document < "u" && typeof window < "u";
}
function or(t) {
  return So() ? Math.min(t, sa) : t;
}
function Ro(t, e2) {
  let n = t === "SSE" ? "sh" : t === "SZSE" ? "sz" : t === "BSE" ? "bj" : void 0;
  if (!n) throw new a(`Sina has no CN K-line mapping for exchange: ${t}`, "sina");
  return `${n}${e2}`;
}
function yo(t) {
  let e2 = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  return e2 ? `${e2[1]}-${e2[2]}-${e2[3]}` : t.slice(0, 10);
}
function ho(t, e2) {
  let n = /^(\d{4})-?(\d{2})-?(\d{2})(?:[ T]?(\d{2}):?(\d{2}))?/.exec(t.trim());
  if (!n) return t;
  let r = n[4] ?? (e2 ? "23" : "00"), o = n[5] ?? (e2 ? "59" : "00");
  return `${n[1]}-${n[2]}-${n[3]} ${r}:${o}`;
}
function To(t) {
  return Math.round(t * 100) / 100;
}
function aa(t) {
  return Math.round(t * 1e3) / 1e3;
}
function ua(t) {
  if (!Array.isArray(t)) {
    let n = t;
    throw n && n.__ERROR !== void 0 ? new l(`Sina K-line request failed: ${String(n.__ERRORMSG ?? n.__ERROR)}`, "sina", ge2) : new a("Sina K-line response is empty", "sina", ge2);
  }
  let e2 = [];
  for (let n of t) {
    if (typeof n?.day != "string") continue;
    let r = u2(n.volume);
    e2.push({ time: n.day.slice(0, 16), open: u2(n.open), high: u2(n.high), low: u2(n.low), close: u2(n.close), volume: r === null ? null : r / 100, amount: u2(n.amount) });
  }
  return e2.sort((n, r) => n.time.localeCompare(r.time));
}
async function Eo(t, e2, n, r) {
  let o = new URLSearchParams({ symbol: e2, scale: String(n), ma: "no", datalen: String(or(r)) }), i = So() ? await K2(`${Cn}?${o.toString()}`, { callbackMode: "path" }) : await t.get(`${ge2}?${o.toString()}`, { responseType: "json", provider: "sina" });
  return ua(i);
}
function la(t) {
  let e2 = /* @__PURE__ */ new Date(`${t}T00:00:00Z`), n = (e2.getUTCDay() + 6) % 7;
  return e2.setUTCDate(e2.getUTCDate() - n), e2.toISOString().slice(0, 10);
}
function ca(t, e2) {
  if (e2 === "daily") return t;
  let n = /* @__PURE__ */ new Map();
  for (let r of t) {
    let o = e2 === "weekly" ? la(r.time) : r.time.slice(0, 7), i = n.get(o);
    i ? i.push(r) : n.set(o, [r]);
  }
  return [...n.values()].map((r) => {
    let o = r[0], i = r[r.length - 1], s3 = r.flatMap((l4) => l4.high === null ? [] : [l4.high]), a3 = r.flatMap((l4) => l4.low === null ? [] : [l4.low]), c2 = r.flatMap((l4) => l4.volume === null ? [] : [l4.volume]);
    return { time: i.time, open: o.open, high: s3.length > 0 ? Math.max(...s3) : null, low: a3.length > 0 ? Math.min(...a3) : null, close: i.close, volume: c2.length > 0 ? Math.round(c2.reduce((l4, d6) => l4 + d6, 0) * 100) / 100 : null, amount: null };
  });
}
function _o(t, e2) {
  let n = t.close !== null && e2 !== null ? aa(t.close - e2) : null;
  return { change: n, changePercent: n !== null && e2 !== null && e2 !== 0 ? To(n / e2 * 100) : null, amplitude: t.high !== null && t.low !== null && e2 !== null && e2 !== 0 ? To((t.high - t.low) / e2 * 100) : null };
}
async function It(t, e2, n = {}) {
  let r = b(e2, { market: "CN" }), o = Ro(r.exchange, r.code), i = n.period ?? "daily", s3 = yo(n.startDate ?? "19700101"), a3 = yo(n.endDate ?? "20500101"), c2 = await Eo(t, o, 240, go);
  if (c2.length >= or(go) && c2[0]?.time > s3) throw new a("Sina history window exceeds the available fallback depth", "sina", ge2);
  let l4 = ca(c2, i);
  return l4.map((d6, p3) => {
    let g2 = N3(d6.time, _2.CN);
    return { date: d6.time, timestamp: g2.timestamp, tz: g2.tz, code: r.code, open: d6.open, high: d6.high, low: d6.low, close: d6.close, volume: d6.volume, amount: null, ..._o(d6, p3 > 0 ? l4[p3 - 1].close : null), turnoverRate: null };
  }).filter((d6) => d6.date >= s3 && d6.date <= a3);
}
async function Nt(t, e2, n) {
  let r = b(e2, { market: "CN" }), o = Ro(r.exchange, r.code), i = n.startDate ? ho(n.startDate, false) : void 0, s3 = n.endDate ? ho(n.endDate, true) : void 0, a3 = await Eo(t, o, Number(n.period), fo);
  if (i !== void 0 && a3.length >= or(fo) && a3[0]?.time > i) throw new a("Sina minute window exceeds the available fallback depth", "sina", ge2);
  return a3.map((c2, l4) => {
    let d6 = N3(c2.time, _2.CN);
    return { time: c2.time, timestamp: d6.timestamp, tz: d6.tz, open: c2.open, high: c2.high, low: c2.low, close: c2.close, volume: c2.volume, amount: c2.amount, ..._o(c2, l4 > 0 ? a3[l4 - 1].close : null), turnoverRate: null };
  }).filter((c2) => (i === void 0 || c2.time >= i) && (s3 === void 0 || c2.time <= s3));
}
var da = /* @__PURE__ */ new Set(["NETWORK_ERROR", "TIMEOUT", "HTTP_ERROR", "RATE_LIMITED", "CIRCUIT_OPEN", "UPSTREAM_EMPTY", "UPSTREAM_ERROR", "PARSE_ERROR"]);
function kt(t) {
  let e2 = O(t);
  return e2 !== void 0 && da.has(e2);
}
var Co = { retry: { maxRetries: 0 }, hostFallback: false };
var Ao = { hostFallback: false };
async function Oo(t, e2, n = {}, r = {}) {
  let o = r.fallback !== false, { period: i = "daily", adjust: s3 = "qfq", startDate: a3 = "19700101", endDate: c2 = "20500101" } = n;
  W3(i), se(s3);
  let l4 = b(e2, { market: "CN" }), d6 = q2(l4), p3 = new URLSearchParams({ fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f116", ut: U3, klt: Z3(i), fqt: le2(s3), secid: d6, beg: a3, end: c2 }), g2;
  try {
    let m2 = await z3(t, ke, p3, o ? Co : Ao);
    if (!m2.dataPresent) throw new a("Eastmoney K-line response has no data payload", "eastmoney", ke);
    g2 = m2.klines;
  } catch (m2) {
    if (!o || !kt(m2)) throw m2;
    try {
      return await At(t, e2, n);
    } catch (f3) {
      if (!kt(f3)) throw m2;
      try {
        return await It(t, e2, n);
      } catch {
        throw m2;
      }
    }
  }
  return g2.length === 0 ? [] : g2.map((m2) => {
    let f3 = Q2(m2), T3 = N3(f3.date, _2.CN);
    return { ...f3, timestamp: T3.timestamp, tz: T3.tz, code: l4.code };
  });
}
var pa = pe2({ trendsUrl: rn, klineUrl: ke, resolveTarget: (t) => {
  let e2 = b(t, { market: "CN" });
  return { secid: q2(e2), code: e2.code };
}, defaultPeriod: "1", ndays: { fixed: "5" }, fqt: "option", includeUt: true, requireKlineData: true, window: { mode: "filter" }, mapTrendRow: ({ time: t, ...e2 }) => {
  let n = N3(t, _2.CN);
  return { time: t, timestamp: n.timestamp, tz: n.tz, ...e2 };
}, mapKlineRow: (t) => {
  let e2 = N3(t.date, _2.CN);
  return { ...t, time: t.date, timestamp: e2.timestamp, tz: e2.tz };
} });
async function Po(t, e2, n = {}, r = {}) {
  let o = r.fallback !== false, i = n.period ?? "1";
  De(i), i !== "1" && se(n.adjust ?? "qfq");
  try {
    return await pa(t, e2, n, o ? Co : Ao);
  } catch (s3) {
    if (!o || i === "1" || !kt(s3)) throw s3;
    try {
      return await Ot(t, e2, { period: i, startDate: n.startDate, endDate: n.endDate });
    } catch (a3) {
      if (!kt(a3)) throw s3;
      try {
        return await Nt(t, e2, { period: i, startDate: n.startDate, endDate: n.endDate });
      } catch {
        throw s3;
      }
    }
  }
}
function ir(t, e2) {
  return new URLSearchParams({ fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61", ut: U3, klt: e2.klt, fqt: e2.fqt, secid: t, beg: e2.beg ?? "19700101", end: e2.end ?? "20500101", lmt: e2.lmt });
}
function Mt(t) {
  return async function(n, r, o = {}) {
    let { period: i = "daily", adjust: s3 = "qfq", startDate: a3 = "19700101", endDate: c2 = "20500101" } = o;
    W3(i), se(s3);
    let l4 = t.normalizeSymbol(r), d6 = ir(l4.secid, { klt: Z3(i), fqt: le2(s3), lmt: "1000000", beg: a3, end: c2 }), { klines: p3, name: g2, code: m2 } = await z3(n, t.url, d6);
    if (p3.length === 0) return [];
    let f3 = t.resolveResultMeta ? t.resolveResultMeta(r, l4, { code: m2, name: g2 }) : { code: m2 || l4.fallbackCode, name: g2 || "" };
    return p3.map((T3) => {
      let h3 = Q2(T3), C = N3(h3.date, t.tz), O2 = { ...h3, timestamp: C.timestamp, tz: C.tz, code: f3.code, name: f3.name };
      return t.enrichItem(O2);
    });
  };
}
var ma = Mt({ url: dt, tz: _2.HK, normalizeSymbol: (t) => {
  let e2 = b(t, { market: "HK" });
  return { secid: q2(e2), fallbackCode: e2.code };
}, enrichItem: (t) => ({ ...t, currency: "HKD", lotSize: null }) });
async function Do(t, e2, n = {}) {
  return ma(t, e2, n);
}
var ga = pe2({ trendsUrl: on, klineUrl: dt, resolveTarget: (t) => {
  let e2 = b(t, { market: "HK" });
  return { secid: q2(e2), code: e2.code };
}, defaultPeriod: "1", ndays: "option", fqt: "option", includeUt: true, window: { mode: "filter" }, ...bt(_2.HK, "HKD") });
async function bo(t, e2, n = {}) {
  return ga(t, e2, n);
}
var Io = "__NOT_FOUND__";
var fa = 10080 * 60 * 1e3;
var ya = 3600 * 1e3;
var ha = [B.NASDAQ, B.NYSE, B.AMEX];
function Ta(t) {
  return T(t, "eastmoney:us-secid", { maxSize: 4096 });
}
async function No(t, e2) {
  if (/^\d{2,3}\./.test(e2)) return e2;
  let n = b(e2, { market: "US" });
  if (n.assetType === "index") return q2(n);
  let r = n.code, o = Ta(t);
  if (o.get(r) === Io) throw new E(`\u7F8E\u80A1\u4EE3\u7801\u4E0D\u5B58\u5728\u6216\u4E0D\u652F\u6301: ${r}`, "eastmoney");
  return o.getOrFetch(r, () => Sa(t, r, o), fa);
}
async function Sa(t, e2, n) {
  let r = false;
  try {
    let o = await Pt(t);
    r = true;
    let i = o.find((s3) => s3.slice(s3.indexOf(".") + 1) === e2);
    if (i) return i;
  } catch {
  }
  for (let o of ha) {
    let i = `${o}.${e2}`;
    if ((await z3(t, Me, ir(i, { klt: "101", fqt: "0", lmt: "1" }))).klines.length > 0) return i;
  }
  throw r && n.set(e2, Io, ya), new E(`\u7F8E\u80A1\u4EE3\u7801\u4E0D\u5B58\u5728\u6216\u4E0D\u652F\u6301: ${e2}`, "eastmoney");
}
function ko(t, e2) {
  return V(t)?.code ?? e2;
}
var Ra = Mt({ url: Me, tz: _2.US, normalizeSymbol: (t) => ({ secid: t, fallbackCode: t.split(".")[1] || t }), resolveResultMeta: (t, e2, n) => ({ code: ko(e2.secid, n.code || e2.fallbackCode), name: n.name || "" }), enrichItem: (t) => ({ ...t, currency: "USD" }) });
async function Mo(t, e2, n = {}) {
  let r = await No(t, e2);
  return Ra(t, r, n);
}
var Ea = pe2({ trendsUrl: sn, klineUrl: Me, resolveTarget: (t) => ({ secid: t, code: ko(t, t.split(".")[1] || t) }), defaultPeriod: "1", ndays: "option", fqt: "option", includeUt: true, window: { mode: "filter", endExtraDays: 1 }, ...bt(_2.US, "USD") });
async function Lo(t, e2, n = {}) {
  let r = await No(t, e2);
  return Ea(t, r, n);
}
var _a = { defaultTTL: 3600 * 1e3, maxSize: 4 };
function Fo(t) {
  return { async getCode(e2, n, r) {
    if (n.startsWith("BK")) return n;
    let s3 = (await T(e2, `eastmoney:board-code-map:${t.type}`, _a).getOrFetch("name-code-map", async () => {
      let a3 = await r(e2);
      if (a3.length === 0) throw new a(`${t.errorPrefix}: \u677F\u5757\u5217\u8868\u63A5\u53E3\u8FD4\u56DE\u7A7A\u6570\u636E`, "eastmoney");
      return Object.fromEntries(a3.map((c2) => [c2.name, c2.code]));
    }))[n];
    if (!s3) throw new E(`${t.errorPrefix}: ${n}`, "eastmoney");
    return s3;
  } };
}
async function Uo(t, e2) {
  let n = { po: "1", np: "1", ut: "bd1d9ddb04089700cf9c27f6f7426281", fltt: "2", invt: "2", fid: e2.type === "concept" ? "f12" : "f3", fs: e2.fsFilter }, r = e2.type === "concept" ? "f2,f3,f4,f8,f12,f14,f15,f16,f17,f18,f20,f21,f24,f25,f22,f33,f11,f62,f128,f124,f107,f104,f105,f136" : "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f24,f25,f26,f22,f33,f11,f62,f128,f136,f115,f152,f124,f107,f104,f105,f140,f141,f207,f208,f209,f222", o = await rr(t, e2.listUrl, n, r, 100, (i, s3) => ({ rank: s3, name: String(i.f14 ?? ""), code: String(i.f12 ?? ""), price: u2(i.f2), change: u2(i.f4), changePercent: u2(i.f3), totalMarketCap: u2(i.f20), turnoverRate: u2(i.f8), riseCount: u2(i.f104), fallCount: u2(i.f105), leadingStock: i.f128 ? String(i.f128) : null, leadingStockChangePercent: u2(i.f136) }));
  return o.sort((i, s3) => (s3.changePercent ?? 0) - (i.changePercent ?? 0)), o.forEach((i, s3) => {
    i.rank = s3 + 1;
  }), o;
}
async function vo(t, e2, n) {
  let r = new URLSearchParams({ fields: "f43,f44,f45,f46,f47,f48,f170,f171,f168,f169", mpi: "1000", invt: "2", fltt: "1", secid: `90.${e2}` }), o = `${n}?${r.toString()}`, s3 = (await t.get(o, { responseType: "json" }))?.data;
  return s3 ? [{ key: "f43", name: "\u6700\u65B0", divide: true }, { key: "f44", name: "\u6700\u9AD8", divide: true }, { key: "f45", name: "\u6700\u4F4E", divide: true }, { key: "f46", name: "\u5F00\u76D8", divide: true }, { key: "f47", name: "\u6210\u4EA4\u91CF", divide: false }, { key: "f48", name: "\u6210\u4EA4\u989D", divide: false }, { key: "f170", name: "\u6DA8\u8DCC\u5E45", divide: true }, { key: "f171", name: "\u632F\u5E45", divide: true }, { key: "f168", name: "\u6362\u624B\u7387", divide: true }, { key: "f169", name: "\u6DA8\u8DCC\u989D", divide: true }].map(({ key: c2, name: l4, divide: d6 }) => {
    let p3 = s3[c2], g2 = null;
    return typeof p3 == "number" && !isNaN(p3) && (g2 = d6 ? p3 / 100 : p3), { item: l4, value: g2 };
  }) : [];
}
async function Ko(t, e2, n) {
  let r = { po: "1", np: "1", ut: "bd1d9ddb04089700cf9c27f6f7426281", fltt: "2", invt: "2", fid: "f3", fs: `b:${e2} f:!50` };
  return rr(t, n, r, "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f24,f25,f22,f11,f62,f128,f136,f115,f152,f45", 100, (i, s3) => ({ rank: s3, code: String(i.f12 ?? ""), name: String(i.f14 ?? ""), price: u2(i.f2), changePercent: u2(i.f3), change: u2(i.f4), volume: u2(i.f5), amount: u2(i.f6), amplitude: u2(i.f7), high: u2(i.f15), low: u2(i.f16), open: u2(i.f17), prevClose: u2(i.f18), turnoverRate: u2(i.f8), pe: u2(i.f9), pb: u2(i.f23) }));
}
async function xo(t, e2, n, r = {}) {
  let { period: o = "daily", adjust: i = "", startDate: s3 = "19700101", endDate: a3 = "20500101" } = r;
  W3(o), se(i);
  let c2 = new URLSearchParams({ secid: `90.${e2}`, fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61", klt: Z3(o), fqt: le2(i), beg: s3, end: a3, smplmt: "10000", lmt: "1000000" }), { klines: l4 } = await z3(t, n, c2);
  return l4.length === 0 ? [] : l4.map((d6) => Q2(d6));
}
var wo = /* @__PURE__ */ new Map();
async function Bo(t, e2, n, r, o = {}) {
  let i = `${n}|${r}`, s3 = wo.get(i);
  return s3 || (s3 = pe2({ trendsUrl: r, klineUrl: n, resolveTarget: (a3) => ({ secid: `90.${a3}`, code: a3 }), defaultPeriod: "5", ndays: { fixed: "1" }, fqt: { fixed: "1" }, includeUt: false, window: { mode: "full", beg: "0", end: "20500101" }, extraKlineParams: { smplmt: "10000", lmt: "1000000" }, mapTrendRow: ({ avgPrice: a3, ...c2 }) => ({ ...c2, price: a3 }), mapKlineRow: (a3) => ({ time: a3.date, open: a3.open, close: a3.close, high: a3.high, low: a3.low, changePercent: a3.changePercent, change: a3.change, volume: a3.volume, amount: a3.amount, amplitude: a3.amplitude, turnoverRate: a3.turnoverRate }) }), wo.set(i, s3)), s3(t, e2, o);
}
function Lt(t) {
  let e2 = Fo(t);
  async function n(o) {
    return Uo(o, t);
  }
  async function r(o, i) {
    return e2.getCode(o, i, n);
  }
  return { async getList(o) {
    return n(o);
  }, async getSpot(o, i) {
    let s3 = await r(o, i);
    return vo(o, s3, t.spotUrl);
  }, async getConstituents(o, i) {
    let s3 = await r(o, i);
    return Ko(o, s3, t.consUrl);
  }, async getKline(o, i, s3 = {}) {
    let a3 = await r(o, i);
    return xo(o, a3, t.klineUrl, s3);
  }, async getMinuteKline(o, i, s3 = {}) {
    let a3 = await r(o, i);
    return Bo(o, a3, t.klineUrl, t.trendsUrl, s3);
  } };
}
var Ca = { type: "industry", fsFilter: "m:90 t:2 f:!50", listUrl: an, spotUrl: un, consUrl: ln, klineUrl: cn, trendsUrl: dn, errorPrefix: "\u672A\u627E\u5230\u884C\u4E1A\u677F\u5757" };
var ze = Lt(Ca);
async function Ho(t) {
  return ze.getList(t);
}
async function qo(t, e2) {
  return ze.getSpot(t, e2);
}
async function $o(t, e2) {
  return ze.getConstituents(t, e2);
}
async function zo(t, e2, n = {}) {
  return ze.getKline(t, e2, n);
}
async function Yo(t, e2, n = {}) {
  return ze.getMinuteKline(t, e2, n);
}
var Aa = { type: "concept", fsFilter: "m:90 t:3 f:!50", listUrl: pn, spotUrl: mn, consUrl: gn, klineUrl: fn, trendsUrl: yn, errorPrefix: "\u672A\u627E\u5230\u6982\u5FF5\u677F\u5757" };
var Ye = Lt(Aa);
async function jo(t) {
  return Ye.getList(t);
}
async function Qo(t, e2) {
  return Ye.getSpot(t, e2);
}
async function Go(t, e2) {
  return Ye.getConstituents(t, e2);
}
async function Wo(t, e2, n = {}) {
  return Ye.getKline(t, e2, n);
}
async function Vo(t, e2, n = {}) {
  return Ye.getMinuteKline(t, e2, n);
}
async function sr(t, e2, n) {
  let { reportName: r, columns: o = "ALL", filter: i, sortColumns: s3, sortTypes: a3, pageSize: c2 = 500, startPage: l4 = 1, fetchAllPages: d6 = true, maxPages: p3 = 1e3, concurrency: g2 = 3, quoteColumns: m2, quoteType: f3, extraParams: T3 } = e2, h3 = async (te2) => {
    let x = new URLSearchParams({ reportName: r, columns: o, pageSize: String(c2), pageNumber: String(te2), source: "WEB", client: "WEB" });
    if (i && x.set("filter", i), s3 && x.set("sortColumns", s3), a3 && x.set("sortTypes", a3), m2 && x.set("quoteColumns", m2), f3 && x.set("quoteType", f3), T3) for (let [cs, ds] of Object.entries(T3)) x.set(cs, ds);
    let Ft = `${hn}?${x.toString()}`, Ut = (await t.get(Ft, { responseType: "json" }))?.result;
    return !Ut || !Array.isArray(Ut.data) ? null : Ut;
  }, C = [], O2 = await h3(l4);
  if (!O2) return { data: [], total: 0, pages: 1 };
  let w = O2.pages ?? 1, ae2 = O2.count ?? O2.data.length, Oe2 = (te2) => {
    C.push(...te2.map((x, Ft) => n(x, C.length + Ft)));
  };
  if (Oe2(O2.data), !d6 || w <= l4) return { data: C, total: ae2, pages: w };
  let he3 = Math.min(w, l4 + p3 - 1), ee2 = await $e(l4 + 1, he3, g2, async (te2) => {
    let x = await h3(te2);
    return x === null ? null : { value: x.data };
  });
  for (let te2 of ee2) Oe2(te2);
  let ue2 = ee2.length === he3 - l4;
  return he3 < w && ue2 && console.warn(`[stock-sdk] fetchDatacenter("${r}") truncated at maxPages=${p3} (server reports ${w} pages). Pass a larger \`maxPages\` to fetch the full dataset.`), { data: C, total: ae2, pages: w };
}
async function D3(t, e2, n) {
  return (await sr(t, e2, n)).data;
}
function v3(t) {
  if (t == null) return "";
  let e2 = String(t), n = e2.match(/^(\d{4}-\d{2}-\d{2})/);
  return n ? n[1] : e2;
}
function fe2(t) {
  if (!t) return null;
  let e2 = t.match(/^(\d{4}-\d{2}-\d{2})/);
  return e2 ? e2[1] : null;
}
function Oa(t) {
  return { code: t.SECURITY_CODE ?? "", name: t.SECURITY_NAME_ABBR ?? "", reportDate: fe2(t.REPORT_DATE), planNoticeDate: fe2(t.PLAN_NOTICE_DATE), disclosureDate: fe2(t.PUBLISH_DATE ?? t.PLAN_NOTICE_DATE), assignTransferRatio: t.BONUS_IT_RATIO ?? null, bonusRatio: t.BONUS_RATIO ?? null, transferRatio: t.IT_RATIO ?? null, dividendPretax: t.PRETAX_BONUS_RMB ?? null, dividendDesc: t.IMPL_PLAN_PROFILE ?? null, dividendYield: t.DIVIDENT_RATIO ?? null, eps: t.BASIC_EPS ?? null, bps: t.BVPS ?? null, capitalReserve: t.PER_CAPITAL_RESERVE ?? null, unassignedProfit: t.PER_UNASSIGN_PROFIT ?? null, netProfitYoy: t.PNP_YOY_RATIO ?? null, totalShares: t.TOTAL_SHARES ?? null, equityRecordDate: fe2(t.EQUITY_RECORD_DATE), exDividendDate: fe2(t.EX_DIVIDEND_DATE), payDate: fe2(t.PAY_DATE), assignProgress: t.ASSIGN_PROGRESS ?? null, noticeDate: fe2(t.NOTICE_DATE) };
}
async function Zo(t, e2) {
  let n = Y2(b(e2, { market: "CN" }));
  return D3(t, { reportName: "RPT_SHAREBONUS_DET", sortColumns: "REPORT_DATE", sortTypes: "-1", pageSize: 500, filter: `(SECURITY_CODE="${n}")` }, (r) => Oa(r));
}
var Pa = "https://fund.eastmoney.com/Data/funddataIndex_Interface.aspx";
var lr = "https://fund.eastmoney.com/pingzhongdata";
function Da() {
  return Number(H3(_2.CN).slice(0, 4));
}
function ba(t, e2) {
  let n = new URLSearchParams({ dt: "8", page: String(e2), rank: t.rank ?? "FSRQ", sort: t.sort ?? "desc", gs: "", ftype: t.fundType ?? "", year: String(t.year ?? Da()) });
  return `${Pa}?${n.toString()}`;
}
function ar(t) {
  if (!t) return null;
  let e2 = t.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return e2 ? e2[1] : null;
}
function Ia(t) {
  return { code: t[0] ?? "", name: t[1] ?? "", equityRecordDate: ar(t[2]), exDividendDate: ar(t[3]), dividendPerShare: A3(t[4]), payDate: ar(t[5]), dividendType: t[6]?.trim() ? t[6].trim() : null };
}
async function ur(t, e2, n) {
  let r = ba(e2, n), o = await de2(r, ["pageinfo", "jjfh_data"], { client: t }), i = o.pageinfo ?? [0, 0, n], [s3 = 0, a3 = 0, c2 = n] = i;
  return { items: (o.jjfh_data ?? []).map(Ia), totalPages: s3, pageSize: a3, currentPage: c2 };
}
async function Xo(t, e2 = {}) {
  if (e2.page === "all") {
    let o = await ur(t, e2, 1), i = o.items;
    for (let s3 = 2; s3 <= o.totalPages; s3++) {
      let a3 = await ur(t, e2, s3);
      i = i.concat(a3.items);
    }
    return e2.code && (i = i.filter((s3) => s3.code === e2.code)), { items: i, totalPages: o.totalPages, pageSize: o.pageSize, currentPage: -1 };
  }
  let n = e2.page ?? 1, r = await ur(t, e2, n);
  return e2.code ? { ...r, items: r.items.filter((o) => o.code === e2.code) } : r;
}
function je(t) {
  return typeof t == "number" && Number.isFinite(t);
}
function cr(t) {
  return H3(_2.CN, t);
}
function dr(t) {
  return me(Ee(t, _2.CN));
}
function J3(t, e2) {
  return t?.find((n) => n.name === e2)?.data ?? [];
}
async function Jo(t, e2) {
  let n = `${lr}/${encodeURIComponent(e2)}.js`, r = await de2(n, ["fS_code", "fS_name", "Data_netWorthTrend", "Data_ACWorthTrend"], { client: t }), o = r.Data_netWorthTrend ?? [], i = /* @__PURE__ */ new Map();
  for (let a3 of r.Data_ACWorthTrend ?? []) Array.isArray(a3) && a3.length >= 2 && je(a3[0]) && i.set(a3[0], A3(a3[1]));
  let s3 = o.filter((a3) => a3 && je(a3.x)).map((a3) => ({ date: cr(a3.x), timestamp: a3.x, nav: A3(a3.y), accNav: i.get(a3.x) ?? null, dailyReturn: A3(a3.equityReturn), unitMoney: a3.unitMoney ?? "" }));
  return { code: r.fS_code ?? e2, name: r.fS_name ?? null, items: s3 };
}
async function ei(t, e2) {
  let n = `${lr}/${encodeURIComponent(e2)}.js`, r = await de2(n, ["fS_code", "fS_name", "Data_rateInSimilarType", "Data_rateInSimilarPersent"], { client: t }), o = r.Data_rateInSimilarType ?? [], i = /* @__PURE__ */ new Map();
  for (let a3 of r.Data_rateInSimilarPersent ?? []) Array.isArray(a3) && a3.length >= 2 && je(a3[0]) && i.set(a3[0], A3(a3[1]));
  let s3 = o.filter((a3) => a3 && je(a3.x)).map((a3) => ({ date: cr(a3.x), timestamp: a3.x, rank: A3(a3.y), total: A3(a3.sc), percentile: i.get(a3.x) ?? null }));
  return { code: r.fS_code ?? e2, name: r.fS_name ?? null, items: s3 };
}
function ti(t) {
  let e2 = t.indexOf(".");
  return e2 < 0 ? { code: t, marketId: "" } : { marketId: t.slice(0, e2), code: t.slice(e2 + 1) };
}
function Na(t) {
  return t ? t.map((e2) => e2.trim()).filter(Boolean).map(ti) : [];
}
function ka(t) {
  return t ? t.split(",").map((e2) => e2.trim()).filter(Boolean).map(ti) : [];
}
function Ma(t) {
  if (!t?.categories?.length || !t?.series) return [];
  let e2 = J3(t.series, "\u80A1\u7968\u5360\u51C0\u6BD4"), n = J3(t.series, "\u503A\u5238\u5360\u51C0\u6BD4"), r = J3(t.series, "\u73B0\u91D1\u5360\u51C0\u6BD4"), o = J3(t.series, "\u5176\u4ED6\u5360\u51C0\u6BD4"), i = J3(t.series, "\u51C0\u8D44\u4EA7");
  return t.categories.map((s3, a3) => ({ date: s3, timestamp: dr(s3), stockRatio: e2[a3] ?? 0, bondRatio: n[a3] ?? 0, cashRatio: r[a3] ?? 0, otherRatio: o[a3] ?? 0, netAsset: i[a3] ?? 0 }));
}
function La(t) {
  return t ? t.filter((e2) => je(e2[0])).map(([e2, n]) => ({ date: cr(e2), timestamp: e2, position: n })) : [];
}
function wa(t) {
  return t ? t.map((e2) => {
    let n = e2?.star;
    return { id: e2?.id ?? "", name: e2?.name ?? "", avatarUrl: e2?.pic?.trim() || null, star: typeof n == "number" && Number.isFinite(n) ? n : null, workTime: e2?.workTime?.trim() || null, fundSize: e2?.fundSize?.trim() || null, power: ni(e2?.power) };
  }) : [];
}
function ni(t) {
  return t?.categories?.length ? { overall: A3(t.avr) ?? 0, categories: t.categories, scores: t.data ?? [], descriptions: t.dsc ?? [] } : null;
}
function Fa(t) {
  if (!t?.categories?.length || !t?.series) return [];
  let e2 = J3(t.series, "\u673A\u6784\u6301\u6709\u6BD4\u4F8B"), n = J3(t.series, "\u4E2A\u4EBA\u6301\u6709\u6BD4\u4F8B"), r = J3(t.series, "\u5185\u90E8\u6301\u6709\u6BD4\u4F8B");
  return t.categories.map((o, i) => ({ date: o, timestamp: dr(o), institutionRatio: e2[i] ?? 0, individualRatio: n[i] ?? 0, internalRatio: r[i] ?? 0 }));
}
function Ua(t) {
  return !t?.categories?.length || !t?.series ? [] : t.categories.map((e2, n) => ({ date: e2, scale: t.series?.[n]?.y ?? 0, mom: t.series?.[n]?.mom ?? "" }));
}
function va(t) {
  if (!t?.categories?.length || !t?.series) return [];
  let e2 = J3(t.series, "\u671F\u95F4\u7533\u8D2D"), n = J3(t.series, "\u671F\u95F4\u8D4E\u56DE"), r = J3(t.series, "\u603B\u4EFD\u989D");
  return t.categories.map((o, i) => ({ date: o, timestamp: dr(o), buy: e2[i] ?? 0, sell: n[i] ?? 0, total: r[i] ?? 0 }));
}
function Ka(t) {
  return { oneMonth: A3(t.syl_1y), threeMonth: A3(t.syl_3y), sixMonth: A3(t.syl_6y), oneYear: A3(t.syl_1n) };
}
function xa(t) {
  if (typeof t != "string") return null;
  let e2 = t.indexOf("_");
  if (e2 < 0) return null;
  let n = t.slice(0, e2);
  if (!n) return null;
  let r = t.lastIndexOf("_");
  return r > e2 ? { code: n, name: t.slice(e2 + 1, r), value: A3(t.slice(r + 1)) } : { code: n, name: t.slice(e2 + 1), value: null };
}
function Ba(t) {
  if (!t?.length) return null;
  let e2 = t.map((n) => (Array.isArray(n) ? n : []).map(xa).filter((r) => r !== null)).filter((n) => n.length > 0);
  return e2.length ? { groups: e2 } : null;
}
async function ri(t, e2) {
  let n = `${lr}/${encodeURIComponent(e2)}.js`, r = await de2(n, ["fS_code", "fS_name", "fund_sourceRate", "fund_Rate", "fund_minsg", "stockCodesNew", "zqCodesNew", "Data_assetAllocation", "Data_fundSharesPositions", "Data_currentFundManager", "Data_performanceEvaluation", "Data_holderStructure", "Data_fluctuationScale", "Data_buySedemption", "syl_1y", "syl_3y", "syl_6y", "syl_1n", "swithSameType"], { client: t });
  return { code: r.fS_code ?? e2, name: r.fS_name ?? null, sourceRate: A3(r.fund_sourceRate), rate: A3(r.fund_Rate), minSubscription: A3(r.fund_minsg), holdings: Na(r.stockCodesNew), bondHoldings: ka(r.zqCodesNew), assetAllocation: Ma(r.Data_assetAllocation), positions: La(r.Data_fundSharesPositions), managers: wa(r.Data_currentFundManager), performance: ni(r.Data_performanceEvaluation), holderStructure: Fa(r.Data_holderStructure), scaleChanges: Ua(r.Data_fluctuationScale), buySedemption: va(r.Data_buySedemption), stageReturns: Ka(r), sameType: Ba(r.swithSameType) };
}
function pr(t) {
  let e2 = t.match(/^([a-zA-Z]+)/);
  if (!e2) throw new c(`Invalid futures symbol: "${t}". Expected format: variety + contract (e.g., rb2605, RBM, IF2604)`);
  return e2[1];
}
function oi(t) {
  return Ce[t] ?? Ce[t.toLowerCase()] ?? Ce[t.toUpperCase()];
}
function mr(t) {
  let e2 = oi(t);
  if (!e2 && t.length > 1 && t.endsWith("M") && (e2 = oi(t.slice(0, -1))), !e2) {
    let r = Object.keys(Ce).join(", ");
    throw new c(`Unknown futures variety: "${t}". Supported varieties: ${r}`);
  }
  let n = _n[e2];
  if (n === void 0) throw new c(`No market code found for exchange: ${e2}`);
  return n;
}
function Ha(t) {
  let e2 = Q2(t), n = t.split(",");
  return { ...e2, openInterest: n.length > 12 ? S(n[12]) : null };
}
async function ii(t, e2, n = {}) {
  let { period: r = "daily", startDate: o = "19700101", endDate: i = "20500101" } = n;
  W3(r);
  let s3 = pr(e2), c2 = `${mr(s3)}.${e2}`, l4 = new URLSearchParams({ fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64", ut: U3, klt: Z3(r), fqt: "0", secid: c2, beg: o, end: i }), { klines: d6, name: p3, code: g2 } = await z3(t, we, l4);
  return d6.length === 0 ? [] : d6.map((m2) => ({ ...Ha(m2), code: g2 || e2, name: p3 || "" }));
}
async function si(t, e2 = {}) {
  let n = e2.pageSize ?? 20, r = [], o = 0, i = 0, s3 = 1e3;
  do {
    let a3 = new URLSearchParams({ orderBy: "dm", sort: "desc", pageSize: String(n), pageIndex: String(o), token: Fe, field: "dm,sc,name,p,zsjd,zde,zdf,f152,o,h,l,zjsj,vol,wp,np,ccl", blockName: "callback" }), c2 = `${En}?${a3.toString()}`, l4 = await t.get(c2, { responseType: "json" });
    if (!l4 || !Array.isArray(l4.list)) break;
    o === 0 && (i = l4.total ?? 0);
    let d6 = l4.list.map(qa);
    if (r.push(...d6), d6.length === 0) break;
    o++;
  } while (r.length < i && o < s3);
  return r;
}
function qa(t) {
  return { code: t.dm || "", name: t.name || "", price: S(String(t.p)), change: S(String(t.zde)), changePercent: S(String(t.zdf)), open: S(String(t.o)), high: S(String(t.h)), low: S(String(t.l)), prevSettle: S(String(t.zjsj)), volume: S(String(t.vol)), buyVolume: S(String(t.wp)), sellVolume: S(String(t.np)), openInterest: S(String(t.ccl)) };
}
function $a(t) {
  let e2 = Q2(t), n = t.split(",");
  return { ...e2, openInterest: n.length > 12 ? S(n[12]) : null };
}
function za(t) {
  let e2 = t.match(/^([A-Z]+)/);
  if (!e2) throw new c(`Invalid global futures symbol: "${t}". Expected format like HG00Y, CL2507`);
  return e2[1];
}
async function ai(t, e2, n = {}) {
  let { period: r = "daily", startDate: o = "19700101", endDate: i = "20500101" } = n;
  W3(r);
  let s3 = n.marketCode;
  if (s3 === void 0) {
    let g2 = za(e2);
    if (s3 = pt[g2], s3 === void 0) {
      let m2 = Object.keys(pt).join(", ");
      throw new c(`Unknown global futures variety: "${g2}". Supported: ${m2}. Or specify marketCode manually via options.`);
    }
  }
  let a3 = `${s3}.${e2}`, c2 = new URLSearchParams({ fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64", ut: U3, klt: Z3(r), fqt: "0", secid: a3, beg: o, end: i }), { klines: l4, name: d6, code: p3 } = await z3(t, we, c2);
  return l4.length === 0 ? [] : l4.map((g2) => ({ ...$a(g2), code: p3 || e2, name: d6 || "" }));
}
async function ui(t, e2 = {}) {
  let { pageSize: n = 2e4 } = e2, r = new URLSearchParams({ orderBy: "zdf", sort: "desc", pageSize: String(n), pageIndex: "0", token: Fe, field: "dm,sc,name,p,zsjd,zde,zdf,f152,vol,cje,ccl,xqj,syr,rz,zjsj,o" }), o = `${bn}?${r.toString()}`, s3 = (await t.get(o, { responseType: "json" }))?.list;
  return Array.isArray(s3) ? s3.map((a3) => ({ code: String(a3.dm ?? ""), name: String(a3.name ?? ""), price: u2(a3.p), change: u2(a3.zde), changePercent: u2(a3.zdf), volume: u2(a3.vol), amount: u2(a3.cje), openInterest: u2(a3.ccl), strikePrice: u2(a3.xqj), remainDays: u2(a3.syr), dailyChange: u2(a3.rz), prevSettle: u2(a3.zjsj), open: u2(a3.o) })) : [];
}
async function li(t, e2, n) {
  let r = new URLSearchParams({ type: "RPT_IF_BILLBOARD_TD", sty: "ALL", p: "1", ps: "200", source: "IFBILLBOARD", client: "WEB", ut: X2, filter: `(SECURITY_CODE="${e2}")(TRADE_DATE='${n}')` }), o = `${In}?${r.toString()}`, s3 = (await t.get(o, { responseType: "json" }))?.result?.data;
  if (!Array.isArray(s3)) return [];
  function a3(c2) {
    if (!c2) return "";
    let l4 = String(c2), d6 = l4.match(/^(\d{4}-\d{2}-\d{2})/);
    return d6 ? d6[1] : l4;
  }
  return s3.map((c2) => ({ tradeType: String(c2.TRADE_TYPE ?? ""), date: a3(c2.TRADE_DATE), symbol: String(c2.SECURITY_CODE ?? ""), targetName: String(c2.TARGET_NAME ?? ""), memberName: String(c2.MEMBER_NAME_ABBR ?? ""), rank: u2(c2.MEMBER_RANK) ?? 0, sellVolume: u2(c2.SELL_VOLUME), sellVolumeChange: u2(c2.SELL_VOLUME_CHANGE), netSellVolume: u2(c2.NET_SELL_VOLUME), sellVolumeRatio: u2(c2.SELL_VOLUME_RATIO), buyVolume: u2(c2.BUY_VOLUME), buyVolumeChange: u2(c2.BUY_VOLUME_CHANGE), netBuyVolume: u2(c2.NET_BUY_VOLUME), buyVolumeRatio: u2(c2.BUY_VOLUME_RATIO), sellPosition: u2(c2.SELL_POSITION), sellPositionChange: u2(c2.SELL_POSITION_CHANGE), netSellPosition: u2(c2.NET_SELL_POSITION), sellPositionRatio: u2(c2.SELL_POSITION_RATIO), buyPosition: u2(c2.BUY_POSITION), buyPositionChange: u2(c2.BUY_POSITION_CHANGE), netBuyPosition: u2(c2.NET_BUY_POSITION), buyPositionRatio: u2(c2.BUY_POSITION_RATIO) }));
}
var Ya = { gold: "EMI00069026", silver: "EMI00069027" };
function ci(t) {
  if (!t) return "";
  let e2 = String(t), n = e2.match(/^(\d{4}-\d{2}-\d{2})/);
  return n ? n[1] : e2;
}
async function di(t) {
  return D3(t, { reportName: "RPT_FUTU_POSITIONCODE", columns: "TRADE_MARKET_CODE,TRADE_CODE,TRADE_TYPE", filter: '(IS_MAINCODE="1")', pageSize: 500, fetchAllPages: false }, (e2) => ({ code: String(e2.TRADE_CODE ?? ""), name: String(e2.TRADE_TYPE ?? ""), marketCode: String(e2.TRADE_MARKET_CODE ?? "") }));
}
async function pi(t, e2, n = {}) {
  let { startDate: r = "2020-10-28", pageSize: o = 500 } = n, i = e2.toUpperCase();
  return D3(t, { reportName: "RPT_FUTU_STOCKDATA", columns: "SECURITY_CODE,TRADE_DATE,ON_WARRANT_NUM,ADDCHANGE", filter: `(SECURITY_CODE="${i}")(TRADE_DATE>='${b2(r)}')`, pageSize: o, sortColumns: "TRADE_DATE", sortTypes: "-1" }, (s3) => ({ code: String(s3.SECURITY_CODE ?? e2), date: ci(s3.TRADE_DATE), inventory: u2(s3.ON_WARRANT_NUM), change: u2(s3.ADDCHANGE) }));
}
async function mi(t, e2, n = {}) {
  let r = Ya[e2];
  if (!r) throw new c(`Invalid COMEX symbol: "${e2}". Must be "gold" or "silver".`);
  let { pageSize: o = 500 } = n, i = { gold: "\u9EC4\u91D1", silver: "\u767D\u94F6" };
  return D3(t, { reportName: "RPT_FUTUOPT_GOLDSIL", sortColumns: "REPORT_DATE", sortTypes: "-1", pageSize: o, filter: `(INDICATOR_ID1="${r}")(@STORAGE_TON<>"NULL")` }, (s3) => ({ date: ci(s3.REPORT_DATE), name: i[e2] ?? e2, storageTon: u2(s3.STORAGE_TON), storageOunce: u2(s3.STORAGE_OUNCE) }));
}
var gi = { daily: "101", weekly: "102", monthly: "103" };
var fr = "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65";
var ja = "f48,f57,f58,f86,f135,f136,f137,f138,f139,f140,f141,f142,f143,f144,f145,f146,f147,f148,f149";
function ye(t, e2) {
  return u2(t[e2]) ?? 0;
}
function Qa(t) {
  let n = ye(t, "f48"), r = ye(t, "f135"), o = ye(t, "f136"), i = ye(t, "f137"), s3 = ye(t, "f147"), a3 = ye(t, "f148"), c2 = ye(t, "f149"), l4 = (m2) => n > 0 ? m2 / n * 100 : 0, d6 = u2(t.f86), p3 = d6 !== null && d6 > 0 ? d6 * 1e3 : null, g2 = p3 === null ? "" : Ne(p3, _2.CN);
  return { code: String(t.f57 ?? ""), mainInflow: r / 1e4, mainOutflow: o / 1e4, mainNet: i / 1e4, mainNetRatio: l4(i), retailInflow: s3 / 1e4, retailOutflow: a3 / 1e4, retailNet: c2 / 1e4, retailNetRatio: l4(c2), totalFlow: n / 1e4, name: String(t.f58 ?? ""), date: g2 ? g2.slice(0, 10).replace(/-/g, "") : "", timestamp: p3, tz: _2.CN };
}
async function fi(t, e2) {
  if (!e2 || e2.length === 0) return [];
  let { keys: n } = W2(e2, "CN");
  if (n.length === 0) return [];
  let r = n.map((i) => async () => {
    let s3 = b(i, { market: "CN" }), a3 = q2(s3), c2 = new URLSearchParams({ secid: a3, fields: ja, ut: U3, invt: "2", fltt: "2" }), l4 = `${Tn}?${c2.toString()}`, d6 = await t.get(l4, { responseType: "json" });
    return d6?.data ? Qa(d6.data) : null;
  });
  return (await V2(r, 5, true)).filter((i) => i !== null);
}
function yi(t) {
  let e2 = t.split(",");
  return { date: e2[0] ?? "", mainNetInflow: S(e2[1]), smallNetInflow: S(e2[2]), mediumNetInflow: S(e2[3]), largeNetInflow: S(e2[4]), superLargeNetInflow: S(e2[5]), mainNetInflowPercent: S(e2[6]), smallNetInflowPercent: S(e2[7]), mediumNetInflowPercent: S(e2[8]), largeNetInflowPercent: S(e2[9]), superLargeNetInflowPercent: S(e2[10]), close: S(e2[11]), changePercent: S(e2[12]) };
}
function Ga(t) {
  let e2 = t.split(",");
  return { date: e2[0] ?? "", mainNetInflow: S(e2[1]), smallNetInflow: S(e2[2]), mediumNetInflow: S(e2[3]), largeNetInflow: S(e2[4]), superLargeNetInflow: S(e2[5]), mainNetInflowPercent: S(e2[6]), smallNetInflowPercent: S(e2[7]), mediumNetInflowPercent: S(e2[8]), largeNetInflowPercent: S(e2[9]), superLargeNetInflowPercent: S(e2[10]), shClose: S(e2[11]), shChangePercent: S(e2[12]), szClose: S(e2[13]), szChangePercent: S(e2[14]) };
}
var hi = { today: { fid: "f62", fields: "f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f124", changePercentField: "f3", mainNet: "f62", mainPct: "f184", superLargeNet: "f66", superLargePct: "f69", largeNet: "f72", largePct: "f75", mediumNet: "f78", mediumPct: "f81", smallNet: "f84", smallPct: "f87" }, "3day": { fid: "f267", fields: "f12,f14,f2,f127,f267,f268,f269,f270,f271,f272,f273,f274,f275,f276,f124", changePercentField: "f127", mainNet: "f267", mainPct: "f268", superLargeNet: "f269", superLargePct: "f270", largeNet: "f271", largePct: "f272", mediumNet: "f273", mediumPct: "f274", smallNet: "f275", smallPct: "f276" }, "5day": { fid: "f164", fields: "f12,f14,f2,f109,f164,f165,f166,f167,f168,f169,f170,f171,f172,f173,f124", changePercentField: "f109", mainNet: "f164", mainPct: "f165", superLargeNet: "f166", superLargePct: "f167", largeNet: "f168", largePct: "f169", mediumNet: "f170", mediumPct: "f171", smallNet: "f172", smallPct: "f173" }, "10day": { fid: "f174", fields: "f12,f14,f2,f160,f174,f175,f176,f177,f178,f179,f180,f181,f182,f183,f124", changePercentField: "f160", mainNet: "f174", mainPct: "f175", superLargeNet: "f176", superLargePct: "f177", largeNet: "f178", largePct: "f179", mediumNet: "f180", mediumPct: "f181", smallNet: "f182", smallPct: "f183" } };
var Wa = { industry: "m:90+t:2", concept: "m:90+t:3", region: "m:90+t:1" };
var Va = "m:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2";
var gr = 100;
async function Ti(t, e2, n, r) {
  let o = new URLSearchParams({ ...e2, pn: String(n), pz: String(r) }), i = `${Sn}?${o.toString()}`, a3 = (await t.get(i, { responseType: "json" }))?.data;
  return !a3 || !Array.isArray(a3.diff) ? null : { total: a3.total, diff: a3.diff };
}
async function Za(t, e2, n = gr, r = 1e3, o = 3) {
  let i = (m2) => Ti(t, e2, m2, n), s3 = [], a3 = await i(1);
  if (!a3) return s3;
  let c2 = a3.total ?? 0;
  if (s3.push(...a3.diff), s3.length >= c2 || a3.diff.length < n) return s3;
  let l4 = n > 0 ? Math.ceil(c2 / n) : 1, d6 = Math.min(l4, r), p3 = await $e(2, d6, o, async (m2) => {
    let f3 = await i(m2);
    return !f3 || f3.diff.length === 0 ? null : { value: f3.diff, terminal: f3.diff.length < n };
  });
  for (let m2 of p3) s3.push(...m2);
  let g2 = p3.length === d6 - 1;
  return l4 > r && g2 && s3.length < c2 && console.warn(`[stock-sdk] fetchClistAllPages truncated at maxPages=${r} (server reports total=${c2}, fetched=${s3.length}). Pass a larger \`maxPages\` to fetch the full dataset.`), s3;
}
async function Si(t, e2, n, r) {
  let o = Dt(n, { defaultPageSize: gr, maxPageSize: gr }, r);
  return o ? (await Ti(t, e2, o.page, o.pageSize))?.diff ?? [] : Za(t, e2);
}
async function Ri(t, e2, n = {}) {
  let { period: r = "daily" } = n, o = gi[r];
  if (!o) throw new c(`Invalid period: ${r}. Must be daily/weekly/monthly.`);
  let i;
  try {
    i = b(e2, { market: "CN" });
  } catch (p3) {
    let g2 = e2.includes(".") ? e2.slice(e2.indexOf(".") + 1) : e2;
    throw p3 instanceof R && E4(g2) ? new c(`Individual fund flow is not available for index symbols: ${e2}`) : p3;
  }
  if (i.assetType === "index" && E4(i.code)) throw new c(`Individual fund flow is not available for index symbols: ${e2}`);
  let s3 = q2(i), a3 = new URLSearchParams({ lmt: "0", klt: o, secid: s3, fields1: "f1,f2,f3,f7", fields2: fr, ut: X2 }), c2 = `${Le}?${a3.toString()}`, d6 = (await t.get(c2, { responseType: "json" }))?.data?.klines;
  return !Array.isArray(d6) || d6.length === 0 ? [] : d6.map(yi);
}
async function Ei(t) {
  let e2 = new URLSearchParams({ lmt: "0", klt: "101", secid: "1.000001", secid2: "0.399001", fields1: "f1,f2,f3,f7", fields2: fr, ut: X2 }), n = `${Le}?${e2.toString()}`, o = (await t.get(n, { responseType: "json" }))?.data?.klines;
  return !Array.isArray(o) || o.length === 0 ? [] : o.map(Ga);
}
async function _i(t, e2 = {}) {
  let { indicator: n = "today" } = e2, r = hi[n];
  if (!r) throw new c(`Invalid indicator: ${n}.`);
  let o = { fid: r.fid, po: "1", np: "1", fltt: "2", invt: "2", ut: X2, fs: Va, fields: r.fields };
  return (await Si(t, o, e2, "fundFlow.rank")).map((s3) => ({ code: String(s3.f12 ?? ""), name: String(s3.f14 ?? ""), price: u2(s3.f2), changePercent: u2(s3[r.changePercentField]), mainNetInflow: u2(s3[r.mainNet]), mainNetInflowPercent: u2(s3[r.mainPct]), superLargeNetInflow: u2(s3[r.superLargeNet]), superLargeNetInflowPercent: u2(s3[r.superLargePct]), largeNetInflow: u2(s3[r.largeNet]), largeNetInflowPercent: u2(s3[r.largePct]), mediumNetInflow: u2(s3[r.mediumNet]), mediumNetInflowPercent: u2(s3[r.mediumPct]), smallNetInflow: u2(s3[r.smallNet]), smallNetInflowPercent: u2(s3[r.smallPct]) }));
}
async function Ci(t, e2 = {}) {
  let { indicator: n = "today", sectorType: r = "industry" } = e2, o = hi[n];
  if (!o) throw new c(`Invalid indicator: ${n}.`);
  let i = Wa[r];
  if (!i) throw new c(`Invalid sectorType: ${r}.`);
  let s3 = `${o.fields},f204,f205`, a3 = { fid: o.fid, po: "1", np: "1", fltt: "2", invt: "2", ut: X2, fs: i, fields: s3 };
  return (await Si(t, a3, e2, "fundFlow.sectorRank")).map((l4) => ({ code: String(l4.f12 ?? ""), name: String(l4.f14 ?? ""), changePercent: u2(l4[o.changePercentField]), mainNetInflow: u2(l4[o.mainNet]), mainNetInflowPercent: u2(l4[o.mainPct]), superLargeNetInflow: u2(l4[o.superLargeNet]), largeNetInflow: u2(l4[o.largeNet]), mediumNetInflow: u2(l4[o.mediumNet]), smallNetInflow: u2(l4[o.smallNet]), topStockCode: l4.f204 ? String(l4.f204) : void 0, topStockName: l4.f205 ? String(l4.f205) : void 0 }));
}
async function Ai(t, e2, n = {}) {
  let { period: r = "daily" } = n, o = gi[r];
  if (!o) throw new c(`Invalid period: ${r}. Must be daily/weekly/monthly.`);
  let i = e2.includes(".") ? e2 : `90.${e2}`, s3 = new URLSearchParams({ lmt: "0", klt: o, secid: i, fields1: "f1,f2,f3,f7", fields2: fr, ut: X2 }), a3 = `${Le}?${s3.toString()}`, l4 = (await t.get(a3, { responseType: "json" }))?.data?.klines;
  return !Array.isArray(l4) || l4.length === 0 ? [] : l4.map(yi);
}
var Xa = { today: "1", "3day": "3", "5day": "5", "10day": "10", month: "M", quarter: "Q", year: "Y" };
var Ja = { shanghai: "001", shenzhen: "003" };
function Oi(t, e2) {
  let n = t.split(",");
  return { date: e2, time: n[0] ?? "", shanghaiNetInflow: S(n[1]), shenzhenNetInflow: S(n[3]), totalNetInflow: S(n[5]) };
}
async function Pi(t, e2 = "north") {
  lt(e2);
  let n = new URLSearchParams({ fields1: "f1,f2,f3,f4", fields2: "f51,f54,f52,f58,f53,f62,f56,f57,f60,f61", ut: X2 }), r = `${Rn}?${n.toString()}`, i = (await t.get(r, { responseType: "json" }))?.data;
  if (!i) return [];
  if (e2 === "south") {
    let c2 = i.n2s ?? [], l4 = i.n2sDate ?? "";
    return c2.map((d6) => Oi(d6, b2(l4)));
  }
  let s3 = i.s2n ?? [], a3 = i.s2nDate ?? "";
  return s3.map((c2) => Oi(c2, b2(a3)));
}
async function Di(t) {
  return D3(t, { reportName: "RPT_MUTUAL_QUOTA", columns: "TRADE_DATE,MUTUAL_TYPE,BOARD_TYPE,MUTUAL_TYPE_NAME,FUNDS_DIRECTION,INDEX_CODE,INDEX_NAME,BOARD_CODE", quoteColumns: "status~07~BOARD_CODE,dayNetAmtIn~07~BOARD_CODE,dayAmtRemain~07~BOARD_CODE,dayAmtThreshold~07~BOARD_CODE,f104~07~BOARD_CODE,f105~07~BOARD_CODE,f106~07~BOARD_CODE,f3~03~INDEX_CODE~INDEX_f3,netBuyAmt~07~BOARD_CODE", quoteType: "0", sortColumns: "MUTUAL_TYPE", sortTypes: "1", pageSize: 2e3, fetchAllPages: false }, (e2) => ({ date: v3(e2.TRADE_DATE), type: String(e2.MUTUAL_TYPE ?? ""), boardName: String(e2.MUTUAL_TYPE_NAME ?? ""), direction: String(e2.FUNDS_DIRECTION ?? ""), status: String(e2.status ?? ""), netBuyAmount: u2(e2.netBuyAmt), netInflow: u2(e2.dayNetAmtIn), remainAmount: u2(e2.dayAmtRemain), upCount: u2(e2.f104), flatCount: u2(e2.f106), downCount: u2(e2.f105), indexCode: String(e2.INDEX_CODE ?? ""), indexName: String(e2.INDEX_NAME ?? ""), indexChangePercent: u2(e2.INDEX_f3) }));
}
async function bi(t, e2 = {}) {
  let { market: n = "all", period: r = "5day", date: o } = e2, i = Xa[r];
  if (!i) throw new c(`Invalid period: ${r}.`);
  let s3 = [`(INTERVAL_TYPE="${i}")`];
  return o && s3.push(`(TRADE_DATE='${o}')`), n !== "all" && s3.push(`(MUTUAL_TYPE="${Ja[n]}")`), D3(t, { reportName: "RPT_MUTUAL_STOCK_NORTHSTA", columns: "ALL", sortColumns: "ADD_MARKET_CAP", sortTypes: "-1", pageSize: 500, filter: s3.join("") }, (a3) => ({ date: v3(a3.TRADE_DATE), code: String(a3.SECURITY_CODE ?? ""), name: String(a3.SECURITY_NAME ?? a3.SECURITY_NAME_ABBR ?? ""), close: u2(a3.CLOSE_PRICE), changePercent: u2(a3.CHANGE_RATE), holdShares: u2(a3.HOLD_SHARES), holdMarketValue: u2(a3.HOLD_MARKET_CAP), holdRatioFloat: u2(a3.HOLD_RATIO), holdRatioTotal: u2(a3.A_SHARES_RATIO), addShares: u2(a3.ADD_SHARES), addMarketValue: u2(a3.ADD_MARKET_CAP), addMarketValuePercent: u2(a3.ADD_MARKET_CAP_PROPORTION), sector: String(a3.BOARD_NAME ?? "") }));
}
async function Ii(t, e2 = "north", n = {}) {
  lt(e2);
  let { startDate: r, endDate: o } = n, i = [e2 === "north" ? '(BOARD_TYPE="1")' : '(BOARD_TYPE="0")'];
  return r && i.push(`(TRADE_DATE>='${b2(r)}')`), o && i.push(`(TRADE_DATE<='${b2(o)}')`), D3(t, { reportName: "RPT_MUTUAL_DEAL_HISTORY", columns: "ALL", sortColumns: "TRADE_DATE", sortTypes: "-1", pageSize: 500, filter: i.join("") }, (s3) => ({ date: v3(s3.TRADE_DATE), netBuyAmount: u2(s3.NET_DEAL_AMT), buyAmount: u2(s3.BUY_AMT), sellAmount: u2(s3.SELL_AMT), accNetBuyAmount: u2(s3.ACCUM_DEAL_AMT), netInflow: u2(s3.FUND_INFLOW), remainAmount: u2(s3.QUOTA_BALANCE), topStockCode: s3.LEAD_STOCKS_CODE ? String(s3.LEAD_STOCKS_CODE) : null, topStockName: s3.LEAD_STOCKS_NAME ? String(s3.LEAD_STOCKS_NAME) : null, topStockChangePercent: u2(s3.LS_CHANGE_RATE) }));
}
async function Ni(t, e2, n = {}) {
  let r = Y2(b(e2, { market: "CN" })), { startDate: o, endDate: i } = n, s3 = [`(SECURITY_CODE="${r}")`];
  return o && s3.push(`(TRADE_DATE>='${b2(o)}')`), i && s3.push(`(TRADE_DATE<='${b2(i)}')`), D3(t, { reportName: "RPT_MUTUAL_HOLDSTOCKNORTH_STA", columns: "ALL", sortColumns: "TRADE_DATE", sortTypes: "-1", pageSize: 500, filter: s3.join("") }, (a3) => ({ date: v3(a3.TRADE_DATE), holdShares: u2(a3.HOLD_SHARES), holdMarketValue: u2(a3.HOLD_MARKET_CAP), holdRatioFloat: u2(a3.HOLD_RATIO), holdRatioTotal: u2(a3.A_SHARES_RATIO), close: u2(a3.CLOSE_PRICE), changePercent: u2(a3.CHANGE_RATE) }));
}
var eu = { zt: { path: "/getTopicZTPool", sort: "fbt:asc" }, yesterday: { path: "/getYesterdayZTPool", sort: "zs:desc" }, strong: { path: "/getTopicQSPool", sort: "zdp:desc" }, sub_new: { path: "/getTopicCXPool", sort: "ods:asc" }, broken: { path: "/getTopicZBPool", sort: "fbt:asc" }, dt: { path: "/getTopicDTPool", sort: "fund:asc" } };
var hr = { rocket_launch: "8201", quick_rebound: "8202", large_buy: "8193", limit_up_seal: "4", limit_down_open: "32", big_buy_order: "64", auction_up: "8207", high_open_5d: "8209", gap_up: "8211", high_60d: "8213", surge_60d: "8215", accelerate_down: "8204", high_dive: "8203", large_sell: "8194", limit_down_seal: "8", limit_up_open: "16", big_sell_order: "128", auction_down: "8208", low_open_5d: "8210", gap_down: "8212", low_60d: "8214", drop_60d: "8216" };
var ki = Object.fromEntries(Object.entries(hr).map(([t, e2]) => [e2, t]));
var Mi = { 8201: "\u706B\u7BAD\u53D1\u5C04", 8202: "\u5FEB\u901F\u53CD\u5F39", 8193: "\u5927\u7B14\u4E70\u5165", 4: "\u5C01\u6DA8\u505C\u677F", 32: "\u6253\u5F00\u8DCC\u505C\u677F", 64: "\u6709\u5927\u4E70\u76D8", 8207: "\u7ADE\u4EF7\u4E0A\u6DA8", 8209: "\u9AD8\u5F005\u65E5\u7EBF", 8211: "\u5411\u4E0A\u7F3A\u53E3", 8213: "60\u65E5\u65B0\u9AD8", 8215: "60\u65E5\u5927\u5E45\u4E0A\u6DA8", 8204: "\u52A0\u901F\u4E0B\u8DCC", 8203: "\u9AD8\u53F0\u8DF3\u6C34", 8194: "\u5927\u7B14\u5356\u51FA", 8: "\u5C01\u8DCC\u505C\u677F", 16: "\u6253\u5F00\u6DA8\u505C\u677F", 128: "\u6709\u5927\u5356\u76D8", 8208: "\u7ADE\u4EF7\u4E0B\u8DCC", 8210: "\u4F4E\u5F005\u65E5\u7EBF", 8212: "\u5411\u4E0B\u7F3A\u53E3", 8214: "60\u65E5\u65B0\u4F4E", 8216: "60\u65E5\u5927\u5E45\u4E0B\u8DCC" };
function wt(t) {
  if (t == null) return "";
  let e2 = String(t).padStart(6, "0");
  return `${e2.slice(0, 2)}:${e2.slice(2, 4)}:${e2.slice(4, 6)}`;
}
function tu(t) {
  if (!t || typeof t != "object") return "";
  let e2 = t;
  return `${e2.days ?? ""}/${e2.ct ?? ""}`;
}
function nu(t) {
  let e2 = u2(t.p), n = u2(t.tp);
  return { code: String(t.c ?? t.m ?? ""), name: String(t.n ?? ""), price: e2 !== null ? e2 / 1e3 : null, changePercent: u2(t.zdp), limitPrice: n !== null ? n / 1e3 : null, amount: u2(t.amount ?? t.zb), floatMarketValue: u2(t.ltsz), totalMarketValue: u2(t.tshare), turnoverRate: u2(t.hs), continuousBoardCount: u2(t.lbc), firstBoardTime: t.fbt !== void 0 && t.fbt !== null ? wt(t.fbt) : null, lastBoardTime: t.lbt !== void 0 && t.lbt !== null ? wt(t.lbt) : null, boardAmount: u2(t.fund), sealAmount: u2(t.fund), failedCount: u2(t.zbc), industry: String(t.hybk ?? ""), ztStatistics: tu(t.zttj), amplitude: u2(t.zf), speed: u2(t.zs) };
}
function Qe(t) {
  if (t) return /^\d{8}$/.test(t) ? t : t.replace(/-/g, "");
}
function Li() {
  return H3(_2.CN).replace(/-/g, "");
}
async function wi(t, e2 = "zt", n) {
  let r = eu[e2];
  if (!r) throw new c(`Invalid ZTPool type: ${e2}.`);
  let o = Qe(n) ?? Li(), i = new URLSearchParams({ ut: U3, dpt: "wz.ztzt", Pageindex: "0", pagesize: "10000", sort: r.sort, date: o }), s3 = `${_e}${r.path}?${i.toString()}`, c2 = (await t.get(s3, { responseType: "json" }))?.data?.pool;
  return !Array.isArray(c2) || c2.length === 0 ? [] : c2.map(nu);
}
var yr = 5e3;
var ru = 10;
var ou = 100;
async function Fi(t, e2 = "large_buy", n = {}) {
  let r = e2 === "all" ? Object.keys(hr) : Array.isArray(e2) ? e2 : [e2];
  if (r.length === 0) throw new c("StockChangeType \u6570\u7EC4\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  let o = r.map((p3) => {
    let g2 = hr[p3];
    if (!g2) throw new c(`Invalid StockChangeType: ${p3}.`);
    return g2;
  }), i = Dt(n, { defaultPageSize: ou, maxPageSize: yr }, "marketEvent.stockChanges"), s3 = o.length === 1 ? o[0] : "", a3 = async (p3, g2) => {
    let m2 = new URLSearchParams({ pageindex: String(p3), pagesize: String(g2), ut: U3, dpt: "wzchanges" }), f3 = `${_e}/getAllStockChanges?type=${o.join(",")}&${m2.toString()}`, T3 = await t.get(f3, { responseType: "json" }), h3 = T3?.data?.allstock;
    return { tc: u2(T3?.data?.tc), list: Array.isArray(h3) ? h3 : [] };
  }, c2 = (p3) => {
    let g2 = String(p3.t ?? s3);
    return { time: wt(p3.tm), code: String(p3.c ?? ""), name: String(p3.n ?? ""), typeCode: g2, changeType: ki[g2] ?? "unknown", changeTypeLabel: Mi[g2] ?? "", info: String(p3.i ?? "") };
  };
  if (i) {
    let { list: p3 } = await a3(i.page - 1, i.pageSize);
    return p3.map(c2);
  }
  let l4 = [], d6 = null;
  for (let p3 = 0; p3 < ru; p3++) {
    let { tc: g2, list: m2 } = await a3(p3, yr);
    if (g2 !== null && (d6 = g2), m2.length === 0) break;
    for (let f3 of m2) l4.push(c2(f3));
    if (m2.length < yr || d6 !== null && l4.length >= d6) break;
  }
  return l4;
}
function Tr(t) {
  let e2 = b(t, { market: "CN" });
  if (e2.assetType !== "stock") throw new c(`\u4E2A\u80A1\u76D8\u53E3\u5F02\u52A8\u4EC5\u652F\u6301 A \u80A1\u4E2A\u80A1,\u6536\u5230 assetType='${e2.assetType}'(symbol=${t})`, { argument: "symbol", value: t, assetType: e2.assetType });
  return e2;
}
async function Ui(t, e2, n) {
  let r = Tr(e2), [o, i] = q2(r).split("."), s3 = Qe(n) ?? Li(), a3 = b2(s3), c2 = new URLSearchParams({ ut: U3, dpt: "wzchanges", code: i, market: o, date: s3 }), l4 = `${_e}/getStockChanges?${c2.toString()}`, p3 = (await t.get(l4, { responseType: "json" }))?.data;
  if (!p3) return { date: a3, available: false, code: r.code, name: "", changes: [] };
  let m2 = (Array.isArray(p3.data) ? p3.data : []).map((h3) => {
    let C = String(h3.t ?? ""), O2 = u2(h3.p);
    return { time: wt(h3.tm), typeCode: C, changeType: ki[C] ?? "unknown", changeTypeLabel: Mi[C] ?? "", price: O2 !== null ? O2 / 1e3 : null, changePercent: u2(h3.u), info: String(h3.i ?? ""), v: u2(h3.v) };
  }), f3 = String(p3.d ?? "");
  return { date: /^\d{8}$/.test(f3) ? b2(f3) : a3, available: true, code: String(p3.c ?? r.code), name: String(p3.n ?? ""), changes: m2 };
}
async function vi(t) {
  let e2 = new URLSearchParams({ ut: U3, dpt: "wzchanges", pageindex: "0", pagesize: "5000" }), n = `${_e}/getAllBKChanges?${e2.toString()}`, o = (await t.get(n, { responseType: "json" }))?.data?.allbk;
  return !Array.isArray(o) || o.length === 0 ? [] : o.map((i) => {
    let s3 = i.ms ?? {}, a3 = s3.m === 0 ? "\u5927\u7B14\u4E70\u5165" : s3.m === 1 ? "\u5927\u7B14\u5356\u51FA" : "", c2 = {};
    if (Array.isArray(i.ydl)) for (let l4 of i.ydl) l4?.t === void 0 || l4.t === null || (c2[String(l4.t)] = Number(l4.ct) || 0);
    else {
      let l4 = i.bkdf ?? i.bkdfdis;
      if (l4 && typeof l4 == "object") for (let [d6, p3] of Object.entries(l4)) c2[d6] = Number(p3) || 0;
    }
    return { name: String(i.n ?? i.bkn ?? ""), changePercent: u2(i.u ?? i.bkz), mainNetInflow: u2(i.zjl ?? i.bkj), totalChangeCount: u2(i.ct ?? i.bkc), topStockCode: String(s3.c ?? ""), topStockName: String(s3.n ?? ""), topStockDirection: a3, changeTypeDistribution: c2 };
  });
}
async function Ki(t, e2 = {}) {
  let { date: n, startDate: r, endDate: o, triggered: i } = e2;
  if (n && (r || o)) throw new c("UnusualFluctuation: date \u4E0E startDate/endDate \u4E0D\u80FD\u540C\u65F6\u6307\u5B9A\u3002");
  let s3 = [];
  return n ? s3.push(`(TRADE_DATE='${b2(Qe(n))}')`) : (r && s3.push(`(TRADE_DATE>='${b2(Qe(r))}')`), o && s3.push(`(TRADE_DATE<='${b2(Qe(o))}')`)), i !== void 0 && s3.push(`(IS_HAPPEN="${i ? 1 : 0}")`), D3(t, { reportName: "RPT_WATCH_UNUSUAL_FLUCTUATE", columns: "ALL", sortColumns: "TRADE_DATE,SECURITY_CODE", sortTypes: "-1,1", pageSize: 500, filter: s3.length > 0 ? s3.join("") : void 0 }, (a3) => {
    let c2 = v3(a3.TRADE_DATE), l4 = N3(c2, _2.CN);
    return { code: String(a3.SECURITY_CODE ?? ""), name: String(a3.SECURITY_NAME_ABBR ?? ""), date: c2, timestamp: l4.timestamp, tz: l4.tz, rule: String(a3.UNUSUAL_TYPE ?? ""), triggered: String(a3.IS_HAPPEN ?? "") === "1", deviationValue: u2(a3.DEVUATION_VALUE), windowDays: u2(a3.MAX_DAYS), changePercent: u2(a3.CHANGE_RATE), direction: String(a3.IS_POSITIVE ?? "") === "1" ? "up" : "down", targetChangePercent: u2(a3.CHANGE_RATE_TARGET) };
  });
}
var xi = { "1month": "01", "3month": "02", "6month": "03", "1year": "04" };
async function Bi(t, e2) {
  let n = b2(e2.startDate), r = b2(e2.endDate);
  return D3(t, { reportName: "RPT_DAILYBILLBOARD_DETAILSNEW", columns: "SECURITY_CODE,SECUCODE,SECURITY_NAME_ABBR,TRADE_DATE,EXPLAIN,CLOSE_PRICE,CHANGE_RATE,BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,BILLBOARD_DEAL_AMT,ACCUM_AMOUNT,DEAL_NET_RATIO,DEAL_AMOUNT_RATIO,TURNOVERRATE,FREE_MARKET_CAP,EXPLANATION,D1_CLOSE_ADJCHRATE,D2_CLOSE_ADJCHRATE,D5_CLOSE_ADJCHRATE,D10_CLOSE_ADJCHRATE", sortColumns: "SECURITY_CODE,TRADE_DATE", sortTypes: "1,-1", pageSize: 5e3, filter: `(TRADE_DATE<='${r}')(TRADE_DATE>='${n}')` }, (o) => ({ code: String(o.SECURITY_CODE ?? ""), name: String(o.SECURITY_NAME_ABBR ?? ""), date: v3(o.TRADE_DATE), close: u2(o.CLOSE_PRICE), changePercent: u2(o.CHANGE_RATE), netBuyAmount: u2(o.BILLBOARD_NET_AMT), buyAmount: u2(o.BILLBOARD_BUY_AMT), sellAmount: u2(o.BILLBOARD_SELL_AMT), dealAmount: u2(o.BILLBOARD_DEAL_AMT), totalAmount: u2(o.ACCUM_AMOUNT), netBuyRatio: u2(o.DEAL_NET_RATIO), dealAmountRatio: u2(o.DEAL_AMOUNT_RATIO), turnoverRate: u2(o.TURNOVERRATE), floatMarketValue: u2(o.FREE_MARKET_CAP), reason: String(o.EXPLANATION ?? o.EXPLAIN ?? ""), afterChange1d: u2(o.D1_CLOSE_ADJCHRATE), afterChange2d: u2(o.D2_CLOSE_ADJCHRATE), afterChange5d: u2(o.D5_CLOSE_ADJCHRATE), afterChange10d: u2(o.D10_CLOSE_ADJCHRATE) }));
}
async function Hi(t, e2 = "1month") {
  let n = xi[e2];
  if (!n) throw new c(`Invalid period: ${e2}.`);
  return D3(t, { reportName: "RPT_BILLBOARD_TRADEALL", columns: "ALL", sortColumns: "BILLBOARD_TIMES,LATEST_TDATE,SECURITY_CODE", sortTypes: "-1,-1,1", pageSize: 5e3, filter: `(STATISTICS_CYCLE="${n}")` }, (r) => ({ code: String(r.SECURITY_CODE ?? ""), name: String(r.SECURITY_NAME_ABBR ?? ""), latestDate: v3(r.LATEST_TDATE), close: u2(r.CLOSE_PRICE), changePercent: u2(r.CHANGE_RATE), count: u2(r.BILLBOARD_TIMES), totalBuyAmount: u2(r.BILLBOARD_BUY_AMT), totalSellAmount: u2(r.BILLBOARD_SELL_AMT), totalNetAmount: u2(r.BILLBOARD_NET_AMT), totalDealAmount: u2(r.BILLBOARD_DEAL_AMT), buyOrgCount: u2(r.ORG_BUY_TIMES), sellOrgCount: u2(r.ORG_SELL_TIMES) }));
}
async function qi(t, e2) {
  let n = b2(e2.startDate), r = b2(e2.endDate);
  return D3(t, { reportName: "RPT_ORGANIZATION_TRADE_DETAILS", columns: "ALL", sortColumns: "TRADE_DATE,SECURITY_CODE", sortTypes: "-1,1", pageSize: 5e3, filter: `(TRADE_DATE<='${r}')(TRADE_DATE>='${n}')` }, (o) => ({ code: String(o.SECURITY_CODE ?? ""), name: String(o.SECURITY_NAME_ABBR ?? ""), date: v3(o.TRADE_DATE), close: u2(o.CLOSE_PRICE), changePercent: u2(o.CHANGE_RATE), buyOrgCount: u2(o.BUY_TIMES), sellOrgCount: u2(o.SELL_TIMES), orgBuyAmount: u2(o.BUY_AMT), orgSellAmount: u2(o.SELL_AMT), orgNetAmount: u2(o.NET_AMT) }));
}
async function $i(t, e2 = "1month") {
  let n = xi[e2];
  if (!n) throw new c(`Invalid period: ${e2}.`);
  return D3(t, { reportName: "RPT_BILLBOARD_TRADEDETAILS", columns: "ALL", sortColumns: "TOTAL_BUYER_SALESTIMES", sortTypes: "-1", pageSize: 5e3, filter: `(STATISTICS_CYCLE="${n}")` }, (r) => ({ code: String(r.OPERATEDEPT_CODE ?? ""), name: String(r.OPERATEDEPT_NAME ?? ""), totalBuyAmount: u2(r.TOTAL_BUYAMT ?? r.BUY_AMT), totalSellAmount: u2(r.TOTAL_SELLAMT ?? r.SELL_AMT), buyCount: u2(r.TOTAL_BUYER_SALESTIMES ?? r.BUY_TIMES), sellCount: u2(r.TOTAL_SELLER_SALESTIMES ?? r.SELL_TIMES), totalCount: u2(r.TOTAL_TIMES) }));
}
async function zi(t, e2, n) {
  let r = Y2(b(e2, { market: "CN" })), o = b2(n), i = `(SECURITY_CODE="${r}")(TRADE_DATE='${o}')`, [s3, a3] = await Promise.all([D3(t, { reportName: "RPT_BILLBOARD_DAILYDETAILSBUY", columns: "ALL", sortColumns: "BUY_AMT_REAL", sortTypes: "-1", pageSize: 100, filter: i }, (c2, l4) => ({ rank: u2(c2.RANK) ?? l4 + 1, branchName: String(c2.OPERATEDEPT_NAME ?? ""), buyAmount: u2(c2.BUY_AMT_REAL ?? c2.BUY_AMT), buyAmountRatio: u2(c2.BUY_RATIO_TOTAL ?? c2.BUY_AMT_RATIO), sellAmount: u2(c2.SELL_AMT_REAL ?? c2.SELL_AMT), sellAmountRatio: u2(c2.SELL_RATIO_TOTAL ?? c2.SELL_AMT_RATIO), netAmount: u2(c2.NET_AMT), side: "buy" })), D3(t, { reportName: "RPT_BILLBOARD_DAILYDETAILSSELL", columns: "ALL", sortColumns: "SELL_AMT_REAL", sortTypes: "-1", pageSize: 100, filter: i }, (c2, l4) => ({ rank: u2(c2.RANK) ?? l4 + 1, branchName: String(c2.OPERATEDEPT_NAME ?? ""), buyAmount: u2(c2.BUY_AMT_REAL ?? c2.BUY_AMT), buyAmountRatio: u2(c2.BUY_RATIO_TOTAL ?? c2.BUY_AMT_RATIO), sellAmount: u2(c2.SELL_AMT_REAL ?? c2.SELL_AMT), sellAmountRatio: u2(c2.SELL_RATIO_TOTAL ?? c2.SELL_AMT_RATIO), netAmount: u2(c2.NET_AMT), side: "sell" }))]);
  return [...s3, ...a3];
}
function Yi(t) {
  if (!t) return "";
  let e2 = t.startDate ? b2(t.startDate) : void 0, n = t.endDate ? b2(t.endDate) : void 0, r = [];
  return e2 && r.push(`(TRADE_DATE>='${e2}')`), n && r.push(`(TRADE_DATE<='${n}')`), r.join("");
}
async function ji(t) {
  return D3(t, { reportName: "PRT_BLOCKTRADE_MARKET_STA", columns: "ALL", sortColumns: "TRADE_DATE", sortTypes: "-1", pageSize: 500 }, (e2) => ({ date: v3(e2.TRADE_DATE), shClose: u2(e2.CLOSE_PRICE ?? e2.SH_CLOSE_PRICE), shChangePercent: u2(e2.CHANGE_RATE ?? e2.SH_CHANGE_RATE), totalAmount: u2(e2.TURNOVER ?? e2.TOTAL_AMOUNT), premiumAmount: u2(e2.PREMIUM_TURNOVER ?? e2.PREMIUM_AMOUNT), premiumRatio: u2(e2.PREMIUM_RATIO), discountAmount: u2(e2.DISCOUNT_TURNOVER ?? e2.DISCOUNT_AMOUNT), discountRatio: u2(e2.DISCOUNT_RATIO) }));
}
async function Qi(t, e2 = {}) {
  let n = Yi(e2);
  return D3(t, { reportName: "RPT_BLOCK_TRADE_DETAIL", columns: "ALL", sortColumns: "TRADE_DATE,SECURITY_CODE", sortTypes: "-1,1", pageSize: 5e3, filter: n || void 0 }, (r) => ({ code: String(r.SECURITY_CODE ?? ""), name: String(r.SECURITY_NAME_ABBR ?? ""), date: v3(r.TRADE_DATE), close: u2(r.CLOSE_PRICE), changePercent: u2(r.CHANGE_RATE), dealPrice: u2(r.DEAL_PRICE ?? r.PRICE), dealVolume: u2(r.DEAL_VOLUME ?? r.VOLUME), dealAmount: u2(r.DEAL_AMT ?? r.TURNOVER), premiumRate: u2(r.PREMIUM_RATIO ?? r.PREMIUM_RATE), buyBranch: String(r.BUYER_DEPT ?? r.BUYER_OPERATEDEPT_NAME ?? ""), sellBranch: String(r.SELLER_DEPT ?? r.SELLER_OPERATEDEPT_NAME ?? "") }));
}
async function Gi(t, e2 = {}) {
  let n = Yi(e2);
  return D3(t, { reportName: "RPT_BLOCK_TRADE_STA", columns: "ALL", sortColumns: "TRADE_DATE,DEAL_AMT", sortTypes: "-1,-1", pageSize: 5e3, filter: n || void 0 }, (r) => ({ code: String(r.SECURITY_CODE ?? ""), name: String(r.SECURITY_NAME_ABBR ?? ""), date: v3(r.TRADE_DATE), changePercent: u2(r.CHANGE_RATE), close: u2(r.CLOSE_PRICE), dealCount: u2(r.DEAL_NUM ?? r.DEAL_COUNT), dealTotalAmount: u2(r.DEAL_AMT ?? r.TOTAL_AMOUNT), dealTotalVolume: u2(r.DEAL_VOLUME ?? r.TOTAL_VOLUME), premiumAmount: u2(r.PREMIUM_AMT ?? r.PREMIUM_AMOUNT), discountAmount: u2(r.DISCOUNT_AMT ?? r.DISCOUNT_AMOUNT) }));
}
async function Wi(t) {
  return D3(t, { reportName: "RPTA_WEB_MARGIN_DAILYTRADE", columns: "ALL", sortColumns: "STATISTICS_DATE", sortTypes: "-1", pageSize: 500 }, (e2) => ({ date: v3(e2.STATISTICS_DATE ?? e2.TRADE_DATE), finBalance: u2(e2.FIN_BALANCE), loanBalance: u2(e2.LOAN_BALANCE), finBuyAmount: u2(e2.FIN_BUY_AMT), loanSellAmount: u2(e2.LOAN_SELL_AMT), investorCount: u2(e2.OPERATE_INVESTOR_NUM ?? e2.INVESTOR_NUM), liabilityInvestorCount: u2(e2.MARGIN_INVESTOR_NUM), totalGuarantee: u2(e2.TOTAL_GUARANTEE), avgGuaranteeRatio: u2(e2.AVG_GUARANTEE_RATIO) }));
}
async function Vi(t, e2) {
  let n = e2 ? `(TRADE_DATE='${b2(e2)}')` : void 0;
  return D3(t, { reportName: "RPT_MARGIN_TRADE_DETAIL", columns: "ALL", sortColumns: "FIN_BALANCE", sortTypes: "-1", pageSize: 5e3, filter: n }, (r) => ({ code: String(r.SECURITY_CODE ?? ""), name: String(r.SECURITY_NAME_ABBR ?? ""), date: v3(r.TRADE_DATE), finBalance: u2(r.FIN_BALANCE), finBuyAmount: u2(r.FIN_BUY_AMT), finRepayAmount: u2(r.FIN_REPAY_AMT), loanBalance: u2(r.LOAN_BALANCE), loanSellVolume: u2(r.LOAN_SELL_VOLUME), loanRepayVolume: u2(r.LOAN_REPAY_VOLUME) }));
}
var Sr = "https://fundmobapi.eastmoney.com/FundMNewApi";
var Rr = { plat: "Android", appType: "ttjj", product: "EFund", Version: "1", deviceid: "stock-sdk" };
async function Zi(t, e2 = {}) {
  let n = e2.sort ?? "ZDF", r = e2.order ?? "desc", o = e2.category ?? "2", i = e2.pageSize ?? 20, s3 = e2.page ?? 1, a3 = new URLSearchParams({ ...Rr, RankItems: n, RankVectors: r, category: o, pageSize: String(i), page: String(s3) }), c2 = `${Sr}/FundMNSubjectList?${a3.toString()}`, l4 = await t.get(c2, { provider: "eastmoney", responseType: "json" }), d6 = l4.Data ?? [], p3 = l4.pageinfo ?? { totalPages: 0, pageSize: i, page: s3 };
  return { items: d6.map((m2) => ({ code: m2.code ?? "", name: m2.name ?? "", dailyChange: A3(m2.ZDF), weeklyReturn: A3(m2.SYL_W), monthlyReturn: A3(m2.SYL_M), quarterlyReturn: A3(m2.SYL_3M), halfYearReturn: A3(m2.SYL_6M), yearlyReturn: A3(m2.SYL_Y), threeYearReturn: A3(m2.SYL_3Y), fiveYearReturn: A3(m2.SYL_5Y), type: m2.isIndustry === 1 ? "\u884C\u4E1A" : m2.isIndustry === 0 ? "\u6982\u5FF5" : "\u884C\u4E1A" })), totalPages: p3.totalPages ?? 0, pageSize: p3.pageSize ?? i, currentPage: p3.page ?? s3 };
}
async function Xi(t, e2 = {}) {
  let n = e2.sort ?? "ZDF", r = e2.order ?? "desc", o = e2.category ?? "2", i = e2.limit ?? 20, s3 = new URLSearchParams({ ...Rr, RankItems: n, RankVectors: r, category: o, limit: String(i) }), a3 = `${Sr}/FundThemeList?${s3.toString()}`;
  return ((await t.get(a3, { provider: "eastmoney", responseType: "json" })).Data ?? []).map((d6) => ({ code: d6.code ?? "", name: d6.name ?? "", dailyChange: A3(d6.ZDF), weeklyReturn: A3(d6.SYL_W), monthlyReturn: A3(d6.SYL_M), quarterlyReturn: A3(d6.SYL_3M), halfYearReturn: A3(d6.SYL_6M), yearlyReturn: A3(d6.SYL_Y), threeYearReturn: A3(d6.SYL_3Y), fiveYearReturn: A3(d6.SYL_5Y), type: d6.isIndustry === 1 ? "\u884C\u4E1A" : d6.isIndustry === 0 ? "\u6982\u5FF5" : "\u884C\u4E1A" }));
}
async function Ji(t, e2, n = {}) {
  let r = n.sortColumn ?? "SYL_1N", o = n.sort ?? "desc", i = n.page ?? 1, s3 = n.pageSize ?? 20, a3 = n.fundType ?? "", c2 = new URLSearchParams({ ...Rr, TOPICAL: e2, SortColumn: r, Sort: o, pageIndex: String(i), pageSize: String(s3), FundType: a3 }), l4 = `${Sr}/FundMNRank?${c2.toString()}`, d6 = await t.get(l4, { provider: "eastmoney", responseType: "json" }), p3 = d6.Data ?? [], g2 = d6.fundinfo ?? { total: 0, pagesize: s3, pageindex: i };
  return { items: p3.map((f3) => ({ code: f3.fscode ?? "", name: f3.abname ?? "", fundType: f3.ftype ?? "", dailyChange: A3(f3.ZDF), weeklyReturn: A3(f3.SYL_Z), monthlyReturn: A3(f3.SYL_Y), quarterlyReturn: A3(f3.SYL_3Y), yearlyReturn: A3(f3.SYL_1N), nav: A3(f3.dwjz), themeCode: e2 })), total: g2.total ?? 0, pageIndex: g2.pageindex ?? i, pageSize: g2.pagesize ?? s3 };
}
var G3 = {};
e(G3, { getCommodityOptionKline: () => ls, getCommodityOptionSpot: () => us, getETFOption5DayMinute: () => as, getETFOptionDailyKline: () => ss, getETFOptionExpireDay: () => rs, getETFOptionMinute: () => is, getETFOptionMonths: () => ns, getIndexOptionKline: () => ts, getIndexOptionSpot: () => es, getSinaHistoryKline: () => It, getSinaMinuteKline: () => Nt });
function iu(t) {
  return { buyVolume: u2(t[0]), buyPrice: u2(t[1]), price: u2(t[2]), askPrice: u2(t[3]), askVolume: u2(t[4]), openInterest: u2(t[5]), change: u2(t[6]), strikePrice: u2(t[7]), symbol: t[8] ?? "" };
}
function su(t) {
  return { buyVolume: u2(t[0]), buyPrice: u2(t[1]), price: u2(t[2]), askPrice: u2(t[3]), askVolume: u2(t[4]), openInterest: u2(t[5]), change: u2(t[6]), strikePrice: null, symbol: t[7] ?? "" };
}
async function es(t, e2) {
  let n = `${Ue}?type=futures&product=${t}&exchange=cffex&pinzhong=${e2}`, r = await K2(n), o = r?.result?.data?.up ?? [], i = r?.result?.data?.down ?? [];
  return { calls: o.map(iu), puts: i.map(su) };
}
async function ts(t) {
  let e2 = `${ve}?symbol=${t}`, n = await K2(e2, { callbackMode: "path" });
  return Array.isArray(n) ? n.map((r) => ({ date: r.d, open: u2(r.o), high: u2(r.h), low: u2(r.l), close: u2(r.c), volume: u2(r.v) })) : [];
}
async function ns(t) {
  let e2 = `${An}?exchange=null&cate=${encodeURIComponent(t)}`, r = (await K2(e2))?.result?.data, o = r?.contractMonth ?? [];
  return { months: o.length > 1 ? o.slice(1) : o, stockId: r?.stockId ?? "", cateId: r?.cateId ?? "", cateList: r?.cateList ?? [] };
}
async function rs(t, e2) {
  let n = `${mt}?exchange=null&cate=${encodeURIComponent(t)}&date=${e2}`, r = await K2(n), o = r?.result?.data?.remainderDays;
  if (typeof o == "number" && o < 0) {
    let s3 = `${mt}?exchange=null&cate=${encodeURIComponent("XD" + t)}&date=${e2}`;
    r = await K2(s3);
  }
  let i = r?.result?.data;
  return { expireDay: i?.expireDay ?? "", remainderDays: i?.remainderDays ?? 0, stockId: i?.stockId ?? "", name: i?.other?.name ?? "" };
}
function os(t) {
  let e2 = "";
  return t.map((n) => (n.d && (e2 = n.d), { time: n.i, date: e2, price: u2(n.p), volume: u2(n.v), openInterest: u2(n.t), avgPrice: u2(n.a) }));
}
async function is(t) {
  let e2 = `CON_OP_${t}`, n = `${On}?symbol=${e2}`, o = (await K2(n))?.result?.data;
  return Array.isArray(o) ? os(o) : [];
}
async function ss(t) {
  let e2 = `CON_OP_${t}`, n = `${Pn}?symbol=${e2}`, r = await K2(n, { callbackMode: "path" });
  return Array.isArray(r) ? r.map((o) => ({ date: o.d, open: u2(o.o), high: u2(o.h), low: u2(o.l), close: u2(o.c), volume: u2(o.v) })) : [];
}
async function as(t) {
  let e2 = `CON_OP_${t}`, n = `${Dn}?symbol=${e2}`, o = (await K2(n))?.result?.data;
  if (!Array.isArray(o)) return [];
  let i = [];
  for (let s3 of o) Array.isArray(s3) && i.push(...os(s3));
  return i;
}
function au(t) {
  return { buyVolume: u2(t[0]), buyPrice: u2(t[1]), price: u2(t[2]), askPrice: u2(t[3]), askVolume: u2(t[4]), openInterest: u2(t[5]), change: u2(t[6]), strikePrice: u2(t[7]), symbol: t[8] ?? "" };
}
function uu(t) {
  return { buyVolume: u2(t[0]), buyPrice: u2(t[1]), price: u2(t[2]), askPrice: u2(t[3]), askVolume: u2(t[4]), openInterest: u2(t[5]), change: u2(t[6]), strikePrice: null, symbol: t[7] ?? "" };
}
async function us(t, e2) {
  let n = gt[t];
  if (!n) throw new c(`Unknown commodity option variety: "${t}". Available: ${Object.keys(gt).join(", ")}`);
  let r = `${Ue}?type=futures&product=${n.product}&exchange=${n.exchange}&pinzhong=${e2}`, o = await K2(r), i = o?.result?.data?.up ?? [], s3 = o?.result?.data?.down ?? [];
  return { calls: i.map(au), puts: s3.map(uu) };
}
async function ls(t) {
  let e2 = `${ve}?symbol=${t}`, n = await K2(e2, { callbackMode: "path" });
  return Array.isArray(n) ? n.map((r) => ({ date: r.d, open: u2(r.o), high: u2(r.h), low: u2(r.l), close: u2(r.c), volume: u2(r.v) })) : [];
}
var k2 = class {
  constructor(e2) {
    this.client = e2;
  }
};
var Ge = class extends k2 {
  constructor(n) {
    super(n);
    this.theme = new Er(this.client);
  }
  getFundDividendList(n) {
    return y2.getFundDividendList(this.client, n);
  }
  getFundNavHistory(n) {
    return y2.getFundNavHistory(this.client, n);
  }
  getFundRankHistory(n) {
    return y2.getFundRankHistory(this.client, n);
  }
  getFundProfile(n) {
    return y2.getFundProfile(this.client, n);
  }
};
var Er = class {
  constructor(e2) {
    this.client = e2;
  }
  getThemeList(e2) {
    return y2.getThemeList(this.client, e2);
  }
  getThemeFunds(e2, n) {
    return y2.getThemeFunds(this.client, e2, n);
  }
};
var We = class extends k2 {
  constructor(e2) {
    super(e2);
  }
  getFullQuotes(e2) {
    return F4.getFullQuotes(this.client, e2);
  }
  getSimpleQuotes(e2) {
    return F4.getSimpleQuotes(this.client, e2);
  }
  getHKQuotes(e2) {
    return F4.getHKQuotes(this.client, e2);
  }
  getUSQuotes(e2) {
    return F4.getUSQuotes(this.client, e2);
  }
  getFundQuotes(e2) {
    return F4.getFundQuotes(this.client, e2);
  }
  getFundFlow(e2) {
    return y2.getRealtimeFundFlow(this.client, e2);
  }
  getPanelLargeOrder(e2) {
    return F4.getPanelLargeOrder(this.client, e2);
  }
  getTodayTimeline(e2) {
    return F4.getTodayTimeline(this.client, e2);
  }
  search(e2) {
    return F4.search(this.client, e2);
  }
  getAShareCodeList(e2) {
    return F4.getAShareCodeList(this.client, e2);
  }
  getUSCodeList(e2) {
    return F4.getUSCodeList(this.client, e2);
  }
  getHKCodeList() {
    return F4.getHKCodeList(this.client);
  }
  getFundCodeList() {
    return F4.getFundCodeList(this.client);
  }
  async getAllAShareQuotes(e2 = {}) {
    let { market: n, ...r } = e2, o = await this.getAShareCodeList({ market: n });
    return F4.getAllQuotesByCodes(this.client, o, r);
  }
  async getAllHKShareQuotes(e2 = {}) {
    let n = await this.getHKCodeList();
    return F4.getAllHKQuotesByCodes(this.client, n, e2);
  }
  async getAllUSShareQuotes(e2 = {}) {
    let { market: n, ...r } = e2, o = await this.getUSCodeList({ simple: true, market: n });
    return F4.getAllUSQuotesByCodes(this.client, o, r);
  }
  getAllQuotesByCodes(e2, n = {}) {
    return F4.getAllQuotesByCodes(this.client, e2, n);
  }
  batchRaw(e2) {
    return this.client.getTencentQuote(e2);
  }
  getTradingCalendar() {
    return F4.getTradingCalendar(this.client);
  }
  getDividendDetail(e2) {
    return y2.getDividendDetail(this.client, e2);
  }
};
var Ve = class extends k2 {
  constructor(e2) {
    super(e2);
  }
  getIndustryList() {
    return y2.getIndustryList(this.client);
  }
  getIndustrySpot(e2) {
    return y2.getIndustrySpot(this.client, e2);
  }
  getIndustryConstituents(e2) {
    return y2.getIndustryConstituents(this.client, e2);
  }
  getIndustryKline(e2, n) {
    return y2.getIndustryKline(this.client, e2, n);
  }
  getIndustryMinuteKline(e2, n) {
    return y2.getIndustryMinuteKline(this.client, e2, n);
  }
  getConceptList() {
    return y2.getConceptList(this.client);
  }
  getConceptSpot(e2) {
    return y2.getConceptSpot(this.client, e2);
  }
  getConceptConstituents(e2) {
    return y2.getConceptConstituents(this.client, e2);
  }
  getConceptKline(e2, n) {
    return y2.getConceptKline(this.client, e2, n);
  }
  getConceptMinuteKline(e2, n) {
    return y2.getConceptMinuteKline(this.client, e2, n);
  }
};
var Ze = class extends k2 {
  constructor(n, r = {}) {
    super(n);
    this.source = r;
  }
  getHistoryKline(n, r) {
    return y2.getHistoryKline(this.client, n, r, this.source);
  }
  getEastmoneyHistoryKline(n, r) {
    return y2.getHistoryKline(this.client, n, r, { fallback: false });
  }
  getMinuteKline(n, r) {
    return y2.getMinuteKline(this.client, n, r, this.source);
  }
  getHKHistoryKline(n, r) {
    return y2.getHKHistoryKline(this.client, n, r);
  }
  getHKMinuteKline(n, r) {
    return y2.getHKMinuteKline(this.client, n, r);
  }
  getUSHistoryKline(n, r) {
    return y2.getUSHistoryKline(this.client, n, r);
  }
  getUSMinuteKline(n, r) {
    return y2.getUSMinuteKline(this.client, n, r);
  }
};
var Xe = class extends k2 {
  constructor(e2) {
    super(e2);
  }
  getFuturesKline(e2, n) {
    return y2.getFuturesHistoryKline(this.client, e2, n);
  }
  getGlobalFuturesSpot(e2) {
    return y2.getGlobalFuturesSpot(this.client, e2);
  }
  getGlobalFuturesKline(e2, n) {
    return y2.getGlobalFuturesKline(this.client, e2, n);
  }
  getFuturesInventorySymbols() {
    return y2.getFuturesInventorySymbols(this.client);
  }
  getFuturesInventory(e2, n) {
    return y2.getFuturesInventory(this.client, e2, n);
  }
  getComexInventory(e2, n) {
    return y2.getComexInventory(this.client, e2, n);
  }
};
var Je = class extends k2 {
  constructor(e2) {
    super(e2);
  }
  getIndexOptionSpot(e2, n) {
    return G3.getIndexOptionSpot(e2, n);
  }
  getIndexOptionKline(e2) {
    return G3.getIndexOptionKline(e2);
  }
  getCFFEXOptionQuotes(e2) {
    return y2.getCFFEXOptionQuotes(this.client, e2);
  }
  getETFOptionMonths(e2) {
    return G3.getETFOptionMonths(e2);
  }
  getETFOptionExpireDay(e2, n) {
    return G3.getETFOptionExpireDay(e2, n);
  }
  getETFOptionMinute(e2) {
    return G3.getETFOptionMinute(e2);
  }
  getETFOptionDailyKline(e2) {
    return G3.getETFOptionDailyKline(e2);
  }
  getETFOption5DayMinute(e2) {
    return G3.getETFOption5DayMinute(e2);
  }
  getCommodityOptionSpot(e2, n) {
    return G3.getCommodityOptionSpot(e2, n);
  }
  getCommodityOptionKline(e2) {
    return G3.getCommodityOptionKline(e2);
  }
  getOptionLHB(e2, n) {
    return y2.getOptionLHB(this.client, e2, n);
  }
};
var lu = 500;
var cu = 15;
var et = class {
  constructor(e2, n) {
    this.klineService = e2;
    this.quoteService = n;
  }
  detectMarket(e2) {
    let n = j2(e2);
    if (n === "GLOBAL") throw new c(`No kline route for GLOBAL-market symbol '${e2}'; use the US kline API with a raw secid instead (e.g. kline.us('100.GDAXI'))`);
    return n === "HK" ? "HK" : n === "US" ? "US" : "A";
  }
  calcActualStartDate(e2, n, r = 1.5) {
    let o = this.toCompactDate(e2), i = Math.ceil(n * r), s3 = new Date(parseInt(o.slice(0, 4)), parseInt(o.slice(4, 6)) - 1, parseInt(o.slice(6, 8)));
    s3.setDate(s3.getDate() - i);
    let a3 = s3.getFullYear(), c2 = String(s3.getMonth() + 1).padStart(2, "0"), l4 = String(s3.getDate()).padStart(2, "0");
    return `${a3}${c2}${l4}`;
  }
  calcActualStartDateByCalendar(e2, n, r) {
    if (!r || r.length === 0) return;
    let o = r.findIndex((s3) => s3 >= e2);
    o === -1 && (o = r.length - 1);
    let i = Math.max(0, o - n);
    return this.toCompactDate(r[i]);
  }
  tryNormalizeDate(e2) {
    let n = e2.trim();
    return /^\d{4}-\d{2}-\d{2}/.test(n) ? n.slice(0, 10) : /^\d{8}$/.test(n) ? `${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 8)}` : null;
  }
  normalizeUserDate(e2) {
    let n = this.tryNormalizeDate(e2);
    if (n === null) throw new c(`\u65E5\u671F\u683C\u5F0F\u5E94\u4E3A 'YYYY-MM-DD' \u6216 'YYYYMMDD',\u5F97\u5230 '${e2}'`, { argument: "date", value: e2 });
    return n;
  }
  normalizeRowDate(e2) {
    return this.tryNormalizeDate(e2) ?? e2;
  }
  toCompactDate(e2) {
    return e2.replace(/-/g, "");
  }
  async getKlineWithIndicators(e2, n = {}) {
    let { indicators: r = {} } = n, o = n.startDate ? this.normalizeUserDate(n.startDate) : void 0, i = n.endDate ? this.normalizeUserDate(n.endDate) : void 0, s3 = n.market ?? this.detectMarket(e2), { requiredBars: a3, maxRecursiveLookback: c2 } = ge(r), l4 = { A: 1.5, HK: 1.46, US: 1.45 }, d6, p3 = n.period ?? "daily", g2 = p3 === "weekly" ? 7.5 : p3 === "monthly" ? 31.5 : l4[s3], m2 = p3 === "weekly" ? 5 : p3 === "monthly" ? 21 : 1;
    if (o) if (s3 === "A") try {
      let w = await this.quoteService.getTradingCalendar();
      d6 = this.calcActualStartDateByCalendar(o, a3 * m2, w) ?? this.calcActualStartDate(o, a3, g2);
    } catch {
      d6 = this.calcActualStartDate(o, a3, g2);
    }
    else d6 = this.calcActualStartDate(o, a3, g2);
    let f3 = { period: n.period, adjust: n.adjust, startDate: d6, endDate: i ? this.toCompactDate(i) : void 0 }, T3;
    switch (s3) {
      case "HK":
        T3 = await this.klineService.getHKHistoryKline(e2, f3);
        break;
      case "US":
        T3 = await this.klineService.getUSHistoryKline(e2, f3);
        break;
      default:
        T3 = await this.klineService.getHistoryKline(e2, f3);
    }
    let h3 = 30 + (p3 === "weekly" ? 7 : p3 === "monthly" ? 31 : 0), C = T3.length === 0 || d6 === void 0 || this.normalizeRowDate(T3[0].date) <= B2(this.normalizeRowDate(d6), h3), O2 = false;
    if (o && T3.length < a3 && C) switch (O2 = true, s3) {
      case "HK":
        T3 = await this.klineService.getHKHistoryKline(e2, { ...f3, startDate: void 0 });
        break;
      case "US":
        T3 = await this.klineService.getUSHistoryKline(e2, { ...f3, startDate: void 0 });
        break;
      default:
        T3 = await this.klineService.getHistoryKline(e2, { ...f3, startDate: void 0 });
    }
    if (o) {
      let w = T3.findIndex((ee2) => this.normalizeRowDate(ee2.date) >= o);
      if (w === -1) return [];
      let ae2 = T3, Oe2 = w;
      if (O2 && !de(r)) {
        let ee2 = c2 > 0 ? Math.max(a3, lu, cu * c2) : a3, ue2 = Math.max(0, w - ee2);
        ae2 = T3.slice(ue2), Oe2 = w - ue2;
      }
      let he3 = Number.isInteger(n.leadingBars) && n.leadingBars > 0 ? n.leadingBars : 0;
      if (he3 > 0) {
        let ee2 = Re(ae2, r), ue2 = Math.max(0, Oe2 - he3), te2 = ee2.slice(ue2);
        return i === void 0 ? te2 : te2.filter((x) => this.normalizeRowDate(x.date) <= i);
      }
      return Re(ae2, r).filter((ee2) => {
        let ue2 = this.normalizeRowDate(ee2.date);
        return ue2 >= o && (i === void 0 || ue2 <= i);
      });
    }
    return Re(T3, r);
  }
  async getKlineSignals(e2, n = {}) {
    let r = n.maFast ?? 5, o = n.maSlow ?? 20;
    if (!Number.isInteger(r) || !Number.isInteger(o) || r <= 0 || o <= 0) throw new c(`maFast / maSlow \u5FC5\u987B\u4E3A\u6B63\u6574\u6570\uFF0C\u5F97\u5230 fast=${r} slow=${o}`, { maFast: r, maSlow: o });
    if (r >= o) throw new c(`maFast(${r}) \u5FC5\u987B\u5C0F\u4E8E maSlow(${o})\uFF0C\u5426\u5219\u65E0\u6CD5\u5B9A\u4E49\u91D1\u53C9/\u6B7B\u53C9`, { maFast: r, maSlow: o });
    let i = n.startDate ? this.normalizeUserDate(n.startDate) : void 0, s3 = await this.getKlineWithIndicators(e2, { market: n.market, period: n.period, adjust: n.adjust, startDate: n.startDate, endDate: n.endDate, leadingBars: i ? 1 : 0, indicators: { ma: { periods: [r, o] }, macd: true, kdj: true, rsi: { periods: [6] }, boll: true, sar: true } }), c2 = h2(s3, { ma: { fast: r, slow: o }, macd: true, kdj: {}, rsi: { period: 6 }, boll: true, sar: true }).map((l4) => {
      let d6 = s3[l4.index];
      return { type: l4.type, date: d6?.date ?? "", timestamp: l4.at, close: d6?.close ?? null, ...l4.detail !== void 0 ? { detail: l4.detail } : {} };
    });
    return i ? c2.filter((l4) => this.normalizeRowDate(l4.date) >= i) : c2;
  }
};
var du = 1.5;
var pu = 30;
var tt = class {
  constructor(e2) {
    this.klineService = e2;
  }
  getChipDistribution(e2, n = {}) {
    return this.compute("A", e2, n);
  }
  getHKChipDistribution(e2, n = {}) {
    return this.compute("HK", e2, n);
  }
  getUSChipDistribution(e2, n = {}) {
    return this.compute("US", e2, n);
  }
  async compute(e2, n, r) {
    let { days: o = 90, range: i = 120, adjust: s3, includeHistogram: a3, decimals: c2 } = r;
    if (!Number.isInteger(o) || o < 1) throw new c(`days \u5E94\u4E3A\u6B63\u6574\u6570,\u5F97\u5230 ${JSON.stringify(o)}`, { argument: "days", value: o });
    if (!Number.isInteger(i) || i < 0) throw new c(`range \u5E94\u4E3A\u975E\u8D1F\u6574\u6570(0 = \u5168\u91CF\u7D2F\u8BA1),\u5F97\u5230 ${JSON.stringify(i)}`, { argument: "range", value: i });
    let l4 = await this.fetchDailyKlines(e2, n, s3, o, i);
    return l4.length === 0 ? [] : fe(l4, { range: i, tail: o, includeHistogram: a3, decimals: c2 });
  }
  async fetchDailyKlines(e2, n, r, o, i) {
    let s3 = (f3) => {
      let T3 = { period: "daily", adjust: r, startDate: f3 };
      switch (e2) {
        case "HK":
          return this.klineService.getHKHistoryKline(n, T3);
        case "US":
          return this.klineService.getUSHistoryKline(n, T3);
        default:
          return this.klineService.getEastmoneyHistoryKline(n, T3);
      }
    };
    if (i === 0) return s3(void 0);
    let a3 = { A: _2.CN, HK: _2.HK, US: _2.US }, c2 = o + i, l4 = H3(a3[e2]), d6 = B2(l4, -Math.ceil(c2 * du)), p3 = d6.replace(/-/g, ""), g2 = await s3(p3), m2 = g2.length === 0 || g2[0].date <= B2(d6, pu);
    return g2.length < c2 && m2 && (g2 = await s3(void 0)), g2;
  }
};
var nt = class extends k2 {
  constructor(e2) {
    super(e2);
  }
  getIndividualFundFlow(e2, n) {
    return y2.getIndividualFundFlow(this.client, e2, n);
  }
  getMarketFundFlow() {
    return y2.getMarketFundFlow(this.client);
  }
  getFundFlowRank(e2) {
    return y2.getFundFlowRank(this.client, e2);
  }
  getSectorFundFlowRank(e2) {
    return y2.getSectorFundFlowRank(this.client, e2);
  }
  getSectorFundFlowHistory(e2, n) {
    return y2.getSectorFundFlowHistory(this.client, e2, n);
  }
};
var rt = class extends k2 {
  constructor(e2) {
    super(e2);
  }
  getNorthboundMinute(e2) {
    return y2.getNorthboundMinute(this.client, e2);
  }
  getNorthboundFlowSummary() {
    return y2.getNorthboundFlowSummary(this.client);
  }
  getNorthboundHoldingRank(e2) {
    return y2.getNorthboundHoldingRank(this.client, e2);
  }
  getNorthboundHistory(e2, n) {
    return y2.getNorthboundHistory(this.client, e2, n);
  }
  getNorthboundIndividual(e2, n) {
    return y2.getNorthboundIndividual(this.client, e2, n);
  }
};
var mu = 4;
var ot = class extends k2 {
  constructor(n, r) {
    super(n);
    this.quoteService = r;
  }
  getZTPool(n, r) {
    return y2.getZTPool(this.client, n, r);
  }
  getStockChanges(n, r) {
    return y2.getStockChanges(this.client, n, r);
  }
  getBoardChanges() {
    return y2.getBoardChanges(this.client);
  }
  getUnusualFluctuation(n) {
    return y2.getUnusualFluctuation(this.client, n);
  }
  async getIndividualChanges(n, r = {}) {
    return (await y2.getIndividualStockChanges(this.client, n, r.date)).changes;
  }
  async getIndividualChangesHistory(n, r = {}) {
    let { days: o = 7 } = r;
    if (!Number.isInteger(o) || o < 1 || o > 60) throw new c(`days \u5E94\u4E3A 1~60 \u7684\u6574\u6570,\u5F97\u5230 ${JSON.stringify(o)}`, { argument: "days", value: o });
    let i = y2.assertCnStockSymbol(n), s3 = H3(_2.CN), a3 = B2(s3, -(o - 1)), l4 = (await this.quoteService.getTradingCalendar()).filter((h3) => h3 >= a3 && h3 <= s3), p3 = (await V2(l4.map((h3) => () => y2.getIndividualStockChanges(this.client, n, h3)), mu, true)).map((h3, C) => h3.date === l4[C] ? h3 : { date: l4[C], available: false, code: h3.code, name: "", changes: [] }), g2 = p3.filter((h3) => h3.available), m2 = /* @__PURE__ */ Object.create(null);
    for (let h3 of g2) for (let C of h3.changes) {
      let O2 = C.typeCode || "unknown", w = m2[O2] ?? (m2[O2] = { count: 0, label: C.changeTypeLabel });
      w.count += 1;
    }
    let f3 = g2.find((h3) => h3.name), T3 = p3[0]?.code ?? i.code;
    return { code: f3?.code ?? T3, name: f3?.name ?? "", requestedDays: o, coverage: { from: a3, to: s3, availableFrom: g2[0]?.date ?? null }, days: p3, stats: m2 };
  }
};
var it = class extends k2 {
  constructor(e2) {
    super(e2);
  }
  getDragonTigerDetail(e2) {
    return y2.getDragonTigerDetail(this.client, e2);
  }
  getDragonTigerStockStats(e2) {
    return y2.getDragonTigerStockStats(this.client, e2);
  }
  getDragonTigerInstitution(e2) {
    return y2.getDragonTigerInstitution(this.client, e2);
  }
  getDragonTigerBranchRank(e2) {
    return y2.getDragonTigerBranchRank(this.client, e2);
  }
  getDragonTigerStockSeatDetail(e2, n) {
    return y2.getDragonTigerStockSeatDetail(this.client, e2, n);
  }
};
var st = class extends k2 {
  constructor(e2) {
    super(e2);
  }
  getBlockTradeMarketStat() {
    return y2.getBlockTradeMarketStat(this.client);
  }
  getBlockTradeDetail(e2) {
    return y2.getBlockTradeDetail(this.client, e2);
  }
  getBlockTradeDailyStat(e2) {
    return y2.getBlockTradeDailyStat(this.client, e2);
  }
  getMarginAccountInfo() {
    return y2.getMarginAccountInfo(this.client);
  }
  getMarginTargetList(e2) {
    return y2.getMarginTargetList(this.client, e2);
  }
};
var _r = class {
  constructor(e2 = {}) {
    this._ns = {};
    this.client = new He(e2), this.quoteService = new We(this.client), this.boardService = new Ve(this.client), this.klineService = new Ze(this.client, { fallback: e2.klineFallback }), this.futuresService = new Xe(this.client), this.optionsService = new Je(this.client), this.indicatorService = new et(this.klineService, this.quoteService), this.chipService = new tt(this.klineService), this.fundFlowService = new nt(this.client), this.northboundService = new rt(this.client), this.marketEventService = new ot(this.client, this.quoteService), this.dragonTigerService = new it(this.client), this.dataService = new st(this.client), this.tradingCalendarService = new qe(this.quoteService), this.fundService = new Ge(this.client);
  }
  clearCaches() {
    m(this.client);
  }
  memoNs(e2, n) {
    let r = this._ns[e2];
    return r === void 0 && (r = n(), this._ns[e2] = r), r;
  }
  get quotes() {
    return this.memoNs("quotes", () => {
      let e2 = this.quoteService;
      return { cn: e2.getFullQuotes.bind(e2), cnSimple: e2.getSimpleQuotes.bind(e2), hk: e2.getHKQuotes.bind(e2), us: e2.getUSQuotes.bind(e2), fund: e2.getFundQuotes.bind(e2), fundFlow: e2.getFundFlow.bind(e2), largeOrder: e2.getPanelLargeOrder.bind(e2), timeline: e2.getTodayTimeline.bind(e2) };
    });
  }
  get codes() {
    return this.memoNs("codes", () => {
      let e2 = this.quoteService;
      return { cn: e2.getAShareCodeList.bind(e2), us: e2.getUSCodeList.bind(e2), hk: e2.getHKCodeList.bind(e2), fund: e2.getFundCodeList.bind(e2) };
    });
  }
  get batch() {
    return this.memoNs("batch", () => {
      let e2 = this.quoteService;
      return { cn: e2.getAllAShareQuotes.bind(e2), hk: e2.getAllHKShareQuotes.bind(e2), us: e2.getAllUSShareQuotes.bind(e2), byCodes: e2.getAllQuotesByCodes.bind(e2), raw: e2.batchRaw.bind(e2) };
    });
  }
  get kline() {
    return this.memoNs("kline", () => {
      let e2 = this.klineService, n = this.indicatorService;
      return { cn: e2.getHistoryKline.bind(e2), cnMinute: e2.getMinuteKline.bind(e2), hk: e2.getHKHistoryKline.bind(e2), hkMinute: e2.getHKMinuteKline.bind(e2), us: e2.getUSHistoryKline.bind(e2), usMinute: e2.getUSMinuteKline.bind(e2), withIndicators: n.getKlineWithIndicators.bind(n), signals: n.getKlineSignals.bind(n) };
    });
  }
  get chips() {
    return this.memoNs("chips", () => {
      let e2 = this.chipService;
      return { cn: e2.getChipDistribution.bind(e2), hk: e2.getHKChipDistribution.bind(e2), us: e2.getUSChipDistribution.bind(e2) };
    });
  }
  get board() {
    return this.memoNs("board", () => {
      let e2 = this.boardService;
      return { industry: { list: e2.getIndustryList.bind(e2), spot: e2.getIndustrySpot.bind(e2), constituents: e2.getIndustryConstituents.bind(e2), kline: e2.getIndustryKline.bind(e2), minuteKline: e2.getIndustryMinuteKline.bind(e2) }, concept: { list: e2.getConceptList.bind(e2), spot: e2.getConceptSpot.bind(e2), constituents: e2.getConceptConstituents.bind(e2), kline: e2.getConceptKline.bind(e2), minuteKline: e2.getConceptMinuteKline.bind(e2) } };
    });
  }
  get options() {
    return this.memoNs("options", () => {
      let e2 = this.optionsService;
      return { index: { spot: e2.getIndexOptionSpot.bind(e2), kline: e2.getIndexOptionKline.bind(e2) }, etf: { months: e2.getETFOptionMonths.bind(e2), expireDay: e2.getETFOptionExpireDay.bind(e2), minute: e2.getETFOptionMinute.bind(e2), dailyKline: e2.getETFOptionDailyKline.bind(e2), fiveDayMinute: e2.getETFOption5DayMinute.bind(e2) }, commodity: { spot: e2.getCommodityOptionSpot.bind(e2), kline: e2.getCommodityOptionKline.bind(e2) }, cffex: { quotes: e2.getCFFEXOptionQuotes.bind(e2) }, lhb: e2.getOptionLHB.bind(e2) };
    });
  }
  get futures() {
    return this.memoNs("futures", () => {
      let e2 = this.futuresService;
      return { kline: e2.getFuturesKline.bind(e2), globalSpot: e2.getGlobalFuturesSpot.bind(e2), globalKline: e2.getGlobalFuturesKline.bind(e2), inventorySymbols: e2.getFuturesInventorySymbols.bind(e2), inventory: e2.getFuturesInventory.bind(e2), comexInventory: e2.getComexInventory.bind(e2) };
    });
  }
  get fundFlow() {
    return this.memoNs("fundFlow", () => {
      let e2 = this.fundFlowService;
      return { individual: e2.getIndividualFundFlow.bind(e2), market: e2.getMarketFundFlow.bind(e2), rank: e2.getFundFlowRank.bind(e2), sectorRank: e2.getSectorFundFlowRank.bind(e2), sectorHistory: e2.getSectorFundFlowHistory.bind(e2) };
    });
  }
  get northbound() {
    return this.memoNs("northbound", () => {
      let e2 = this.northboundService;
      return { minute: e2.getNorthboundMinute.bind(e2), summary: e2.getNorthboundFlowSummary.bind(e2), holdingRank: e2.getNorthboundHoldingRank.bind(e2), history: e2.getNorthboundHistory.bind(e2), individual: e2.getNorthboundIndividual.bind(e2) };
    });
  }
  get marketEvent() {
    return this.memoNs("marketEvent", () => {
      let e2 = this.marketEventService;
      return { ztPool: e2.getZTPool.bind(e2), stockChanges: e2.getStockChanges.bind(e2), boardChanges: e2.getBoardChanges.bind(e2), unusualFluctuation: e2.getUnusualFluctuation.bind(e2), individualChanges: e2.getIndividualChanges.bind(e2), individualChangesHistory: e2.getIndividualChangesHistory.bind(e2) };
    });
  }
  get dragonTiger() {
    return this.memoNs("dragonTiger", () => {
      let e2 = this.dragonTigerService;
      return { detail: e2.getDragonTigerDetail.bind(e2), stockStats: e2.getDragonTigerStockStats.bind(e2), institution: e2.getDragonTigerInstitution.bind(e2), branchRank: e2.getDragonTigerBranchRank.bind(e2), seatDetail: e2.getDragonTigerStockSeatDetail.bind(e2) };
    });
  }
  get blockTrade() {
    return this.memoNs("blockTrade", () => {
      let e2 = this.dataService;
      return { marketStat: e2.getBlockTradeMarketStat.bind(e2), detail: e2.getBlockTradeDetail.bind(e2), dailyStat: e2.getBlockTradeDailyStat.bind(e2) };
    });
  }
  get margin() {
    return this.memoNs("margin", () => {
      let e2 = this.dataService;
      return { accountInfo: e2.getMarginAccountInfo.bind(e2), targetList: e2.getMarginTargetList.bind(e2) };
    });
  }
  get fund() {
    return this.memoNs("fund", () => {
      let e2 = this.fundService;
      return { dividendList: e2.getFundDividendList.bind(e2), navHistory: e2.getFundNavHistory.bind(e2), rankHistory: e2.getFundRankHistory.bind(e2), profile: e2.getFundProfile.bind(e2), theme: e2.theme };
    });
  }
  get calendar() {
    return this.memoNs("calendar", () => {
      let e2 = this.tradingCalendarService;
      return { isTradingDay: e2.isTradingDay.bind(e2), nextTradingDay: e2.nextTradingDay.bind(e2), prevTradingDay: e2.prevTradingDay.bind(e2), marketStatus: e2.getMarketStatus.bind(e2) };
    });
  }
  get reference() {
    return this.memoNs("reference", () => {
      let e2 = this.quoteService;
      return { dividendDetail: e2.getDividendDetail.bind(e2), tradingCalendar: e2.getTradingCalendar.bind(e2) };
    });
  }
  search(e2) {
    return this.quoteService.search(e2);
  }
};
var og = _r;

// node_modules/stock-sdk/dist/index.js
var de3 = { 0: "sz", 1: "sh", 100: "global", 105: "us", 116: "hk" };
var he2 = { sh: "CN", sz: "CN", hk: "HK", us: "US" };
var ke2 = { IXIC: ".IXIC", NDX: ".NDX", NDX100: ".NDX" };
var Se = { IXIC: "NDX", NDX: "NDX", NDX100: "NDX" };
function ye2(t) {
  return t === "sh" || t === "sz" || t === "hk" || t === "us" || t === "global";
}
function Oe(t) {
  switch (t.market) {
    case "CN":
      return t.exchange === "SSE" ? "sh" : t.exchange === "SZSE" ? "sz" : "unknown";
    case "HK":
      return "hk";
    case "US":
      return "us";
    case "GLOBAL":
      return "global";
    default:
      return "unknown";
  }
}
function fe3(t) {
  let e2 = t.code.trim(), o = t.market.trim().toLowerCase(), n = de3[t.market] ?? o, s3 = ye2(n) ? n : void 0;
  if (s3 === "global") return { code: e2.replace(/^\d{3}\./, "").toUpperCase(), market: "global" };
  try {
    let r = b(e2, s3 ? { market: he2[s3] } : void 0);
    if (r.assetType !== "stock") return { code: e2, market: "unknown" };
    let a3 = s3 ?? Oe(r);
    return a3 === "unknown" ? { code: e2, market: "unknown" } : { code: r.market === "US" ? r.code.toUpperCase() : r.code, market: a3 };
  } catch {
    return { code: e2, market: "unknown" };
  }
}
function Ce2(t, e2) {
  return e2 === "sh" && t.startsWith("000") || e2 === "sz" && t.startsWith("399");
}
function Me2(t) {
  let { code: e2, market: o } = t;
  return (o === "sh" || o === "sz") && Ce2(e2, o) ? `https://quote.eastmoney.com/zs${e2}.html` : o === "sh" || o === "sz" ? `https://quote.eastmoney.com/${o}${e2}.html` : o === "hk" ? `https://quote.eastmoney.com/hk/${e2}.html` : o === "us" ? `https://quote.eastmoney.com/us/${e2}.html` : o === "global" ? `https://quote.eastmoney.com/gb/zs${Se[e2] ?? e2}.html` : `https://so.eastmoney.com/web/s?keyword=${encodeURIComponent(e2)}`;
}
function ge3(t) {
  let { code: e2, market: o } = t;
  return o === "sh" || o === "sz" ? `https://xueqiu.com/S/${o.toUpperCase()}${e2}` : o === "hk" ? `https://xueqiu.com/S/${e2}` : o === "us" ? `https://xueqiu.com/S/${e2}` : o === "global" ? `https://xueqiu.com/S/${ke2[e2] ?? e2}` : `https://xueqiu.com/k?q=${encodeURIComponent(e2)}`;
}
function Re2(t) {
  let e2 = fe3(t);
  return [{ name: "\u4E1C\u65B9\u8D22\u5BCC", url: Me2(e2) }, { name: "\u96EA\u7403", url: ge3(e2) }];
}
export {
  Es as BROWSER_JSVARS_MUTEX_KEY,
  Ge as FundService,
  u as HttpError,
  H as INDICATOR_REGISTRY,
  _2 as MARKET_TZ,
  a2 as MemoryCache,
  d3 as MemoryCacheStore,
  s as SdkError,
  _r as StockSDK,
  qe as TradingCalendarService,
  Re as addIndicators,
  V2 as asyncPool,
  J as backtest,
  oe as buildIndicatorContext,
  N3 as buildTimeMeta,
  Gt as buildTimeMetaFromDateAndTime,
  f2 as cacheThrough,
  P as calcATR,
  z as calcBIAS,
  q as calcBOLL,
  Q as calcCCI,
  fe as calcChipDistribution,
  ee as calcDMI,
  D as calcEMA,
  ne as calcKC,
  G2 as calcKDJ,
  J2 as calcMA,
  F2 as calcMACD,
  X as calcOBV,
  Z as calcROC,
  U as calcRSI,
  te as calcSAR,
  j as calcSMA,
  h2 as calcSignals,
  le as calcWMA,
  Y as calcWR,
  be2 as chunkArray,
  m as clearClientScopedCaches,
  d2 as configureSharedCache,
  p2 as createCacheKey,
  qt as decodeGBK,
  og as default,
  ge as estimateIndicatorLookback,
  Nr as extractJsonFromJsonp,
  de2 as fetchJsVars,
  Ne as formatInTz,
  Re2 as generateSearchExternalLinks,
  T2 as getEnabledIndicatorKeys,
  O as getSdkErrorCode,
  f as getSharedCache,
  K2 as jsonpRequest,
  b as normalizeSymbol,
  jt as parseJsVars,
  Ee as parseMarketTime,
  $t as parseResponse,
  R3 as safeNumber,
  P2 as safeNumberOrNull,
  G as screen,
  q2 as toEastmoneySecid,
  z2 as toTencentSymbol,
  Yt as withScriptMutex
};
