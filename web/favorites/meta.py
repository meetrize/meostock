"""从 URL 解析网站标题与 favicon。"""

from __future__ import annotations

import html
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

_TITLE_RE = re.compile(
    r"<title[^>]*>(.*?)</title>",
    re.IGNORECASE | re.DOTALL,
)
_ICON_RE = re.compile(
    r"""<link[^>]+rel=["'](?:shortcut\s+icon|icon|apple-touch-icon(?:-precomposed)?)["'][^>]*>""",
    re.IGNORECASE,
)
_HREF_RE = re.compile(r"""href=["']([^"']+)["']""", re.IGNORECASE)
_OG_TITLE_RE = re.compile(
    r"""<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']""",
    re.IGNORECASE,
)
_OG_TITLE_RE2 = re.compile(
    r"""<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']""",
    re.IGNORECASE,
)


def normalize_url(raw: str) -> str:
    u = (raw or "").strip()
    if not u:
        raise ValueError("URL 不能为空")
    if not re.match(r"^https?://", u, re.IGNORECASE):
        u = "https://" + u
    parsed = urllib.parse.urlparse(u)
    if not parsed.netloc:
        raise ValueError("无效的 URL")
    # 去掉 fragment
    return urllib.parse.urlunparse(
        (parsed.scheme.lower(), parsed.netloc, parsed.path or "/", parsed.params, parsed.query, "")
    )


def _decode_html(raw: bytes, content_type: str | None) -> str:
    charset = "utf-8"
    if content_type:
        m = re.search(r"charset=([^\s;]+)", content_type, re.IGNORECASE)
        if m:
            charset = m.group(1).strip("\"'")
    # HTML meta charset
    head = raw[:4096]
    try:
        probe = head.decode("ascii", errors="ignore")
    except Exception:  # noqa: BLE001
        probe = ""
    m = re.search(r'charset=["\']?([\w-]+)', probe, re.IGNORECASE)
    if m:
        charset = m.group(1)
    try:
        return raw.decode(charset, errors="replace")
    except LookupError:
        return raw.decode("utf-8", errors="replace")


def _clean_title(raw: str) -> str:
    t = html.unescape(raw or "")
    t = re.sub(r"\s+", " ", t).strip()
    return t[:200]


def _favicon_candidates(page_url: str, html_text: str) -> list[str]:
    out: list[str] = []
    for m in _ICON_RE.finditer(html_text):
        tag = m.group(0)
        hm = _HREF_RE.search(tag)
        if not hm:
            continue
        href = html.unescape(hm.group(1).strip())
        if href:
            out.append(urllib.parse.urljoin(page_url, href))
    parsed = urllib.parse.urlparse(page_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    out.append(f"{origin}/favicon.ico")
    # 公共兜底（不依赖站点 CORS）
    host = parsed.hostname or ""
    if host:
        out.append(f"https://www.google.com/s2/favicons?domain={urllib.parse.quote(host)}&sz=64")
        out.append(f"https://icons.duckduckgo.com/ip3/{host}.ico")
    # 去重保序
    seen: set[str] = set()
    uniq: list[str] = []
    for u in out:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq


def _pick_favicon(candidates: list[str], timeout: float = 4.0) -> str | None:
    for url in candidates:
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": _UA, "Accept": "image/*,*/*"},
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                code = getattr(resp, "status", 200) or 200
                ctype = (resp.headers.get("Content-Type") or "").lower()
                # 读一点确认非空
                chunk = resp.read(64)
                if code >= 400 or not chunk:
                    continue
                if "text/html" in ctype:
                    continue
                return url
        except Exception:  # noqa: BLE001
            continue
    return candidates[0] if candidates else None


def fetch_site_meta(url: str, *, timeout: float = 10.0) -> dict[str, Any]:
    """返回 ``{url, title, favicon_url, host}``。"""
    page_url = normalize_url(url)
    parsed = urllib.parse.urlparse(page_url)
    host = parsed.hostname or parsed.netloc
    title = host or page_url
    favicon_url: str | None = None
    html_text = ""

    try:
        req = urllib.request.Request(
            page_url,
            headers={
                "User-Agent": _UA,
                "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            final = resp.geturl() or page_url
            page_url = final
            raw = resp.read(512_000)
            html_text = _decode_html(raw, resp.headers.get("Content-Type"))
    except urllib.error.HTTPError as exc:
        # 部分站点拒爬仍可用 host 兜底
        if exc.code in (401, 403, 404, 405):
            pass
        else:
            raise ValueError(f"无法访问该网址（HTTP {exc.code}）") from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"无法访问该网址：{exc.reason}") from exc
    except TimeoutError as exc:
        raise ValueError("访问超时，请检查网址或稍后重试") from exc

    if html_text:
        m = _TITLE_RE.search(html_text)
        if m:
            title = _clean_title(m.group(1)) or title
        else:
            for og in (_OG_TITLE_RE, _OG_TITLE_RE2):
                om = og.search(html_text)
                if om:
                    title = _clean_title(om.group(1)) or title
                    break

    candidates = _favicon_candidates(page_url, html_text)
    favicon_url = _pick_favicon(candidates)

    return {
        "url": page_url,
        "title": title or host or page_url,
        "favicon_url": favicon_url,
        "host": host,
    }
