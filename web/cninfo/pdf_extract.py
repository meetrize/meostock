"""巨潮公告 PDF 下载与正文抽取（短时缓存）。"""

from __future__ import annotations

import logging
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from cninfo.client import USER_AGENT

_log = logging.getLogger("cninfo.pdf_extract")

_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_CACHE = _ROOT / "data" / "cninfo_pdf_cache"
# 默认保留 3 天：仅服务正文抽取；UI 仍走在线 pdf_url
_DEFAULT_TTL_DAYS = 3


def cache_dir() -> Path:
    raw = os.environ.get("CNINFO_PDF_CACHE", "").strip()
    path = Path(raw) if raw else _DEFAULT_CACHE
    path.mkdir(parents=True, exist_ok=True)
    return path


def pdf_ttl_seconds() -> float:
    """缓存存活秒数。CNINFO_PDF_TTL_DAYS，默认 3；设 0 表示下载后立即不复用（仍可落盘到下次清理）。"""
    raw = str(os.environ.get("CNINFO_PDF_TTL_DAYS", "")).strip()
    if not raw:
        days = _DEFAULT_TTL_DAYS
    else:
        try:
            days = float(raw)
        except ValueError:
            days = _DEFAULT_TTL_DAYS
    if days < 0:
        days = _DEFAULT_TTL_DAYS
    return float(days) * 24 * 3600


def cleanup_expired_pdfs(*, ttl_sec: float | None = None) -> dict[str, Any]:
    """
    删除缓存目录中超过 TTL 的 PDF。
    安全约束：只处理 cache_dir() 下的 *.pdf，不递归其它路径。
    """
    root = cache_dir().resolve()
    ttl = float(ttl_sec) if ttl_sec is not None else pdf_ttl_seconds()
    now = time.time()
    deleted = 0
    kept = 0
    errors = 0
    freed = 0
    # ttl=0：仍给最短宽限，避免正在抽取的文件被同轮清理误删；真正「用完即删」见 delete_cached_pdf
    effective_ttl = ttl if ttl > 0 else 0.0
    try:
        files = list(root.glob("*.pdf"))
    except OSError as e:
        _log.warning("list pdf cache failed: %s", e)
        return {"ok": False, "error": str(e), "deleted": 0, "kept": 0, "freed_bytes": 0}

    for path in files:
        try:
            # 拒绝符号链接逃逸
            resolved = path.resolve()
            if not str(resolved).startswith(str(root) + os.sep) and resolved != root:
                continue
            if not resolved.is_file():
                continue
            st = resolved.stat()
            age = now - float(st.st_mtime)
            if effective_ttl <= 0 or age >= effective_ttl:
                size = int(st.st_size)
                resolved.unlink(missing_ok=True)
                deleted += 1
                freed += size
            else:
                kept += 1
        except OSError as e:
            errors += 1
            _log.warning("delete pdf cache failed path=%s err=%s", path, e)

    _log.info(
        "pdf cache cleanup deleted=%s kept=%s freed_mb=%.2f errors=%s ttl_sec=%s",
        deleted,
        kept,
        freed / (1024 * 1024),
        errors,
        effective_ttl,
    )
    return {
        "ok": True,
        "deleted": deleted,
        "kept": kept,
        "freed_bytes": freed,
        "errors": errors,
        "ttl_sec": effective_ttl,
        "cache_dir": str(root),
    }


def delete_cached_pdf(announcement_id: str) -> bool:
    """分析完成后可主动删单文件（可选）；失败返回 False。"""
    safe_id = re.sub(r"[^\w\-]+", "_", str(announcement_id or ""))[:120] or "unknown"
    path = (cache_dir() / f"{safe_id}.pdf").resolve()
    root = cache_dir().resolve()
    try:
        if not str(path).startswith(str(root) + os.sep):
            return False
        if path.is_file():
            path.unlink()
            return True
    except OSError as e:
        _log.warning("delete_cached_pdf failed id=%s err=%s", announcement_id, e)
    return False


def _download(url: str, dest: Path, *, timeout: float = 45.0) -> None:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    if not data or len(data) < 64:
        raise RuntimeError("PDF 内容过短或为空")
    dest.write_bytes(data)


def _extract_pymupdf(path: Path, *, max_chars: int = 18000) -> str:
    import fitz  # type: ignore

    doc = fitz.open(path)
    try:
        chunks: list[str] = []
        total = 0
        keyword_re = re.compile(
            r"重大资产重组|发行股份|标的资产|业绩承诺|商誉|中标|合同金额|"
            r"营收|净利润|立案|退市|逾期|减值|回购注销|增持|减持"
        )
        # 先读前 8 页，再扫含关键词页
        n = len(doc)
        indices = list(range(min(8, n)))
        for i in range(8, n):
            page = doc.load_page(i)
            t = page.get_text("text") or ""
            if keyword_re.search(t):
                indices.append(i)
            if len(indices) >= 16:
                break
        seen: set[int] = set()
        for i in indices:
            if i in seen:
                continue
            seen.add(i)
            text = (doc.load_page(i).get_text("text") or "").strip()
            if not text:
                continue
            chunks.append(text)
            total += len(text)
            if total >= max_chars:
                break
        out = "\n\n".join(chunks)
        return out[:max_chars]
    finally:
        doc.close()


def extract_text_from_pdf(path: Path, *, max_chars: int = 18000) -> str:
    try:
        return _extract_pymupdf(path, max_chars=max_chars)
    except ImportError:
        _log.warning("pymupdf 未安装，无法抽取 PDF 正文")
        raise RuntimeError("缺少 pymupdf，请 pip install pymupdf") from None
    except Exception as e:
        _log.warning("PDF 抽取失败 path=%s err=%s", path, e)
        raise


_AMOUNT_RE = re.compile(
    r"(?P<num>\d+(?:\.\d+)?)\s*(?P<unit>万亿|亿元|亿|万元|万)?\s*(?:元)?"
)
_PCT_REV_RE = re.compile(
    r"占[^。；;\n]{0,24}?(?:营业总?收入|营业收入|营收)[^。；;\n]{0,12}?(?P<p>\d+(?:\.\d+)?)\s*%"
)
_PCT_NAV_RE = re.compile(
    r"占[^。；;\n]{0,24}?(?:净资产|归属于[^。]{0,6}净资产)[^。；;\n]{0,12}?(?P<p>\d+(?:\.\d+)?)\s*%"
)
_PCT_MKT_RE = re.compile(
    r"占[^。；;\n]{0,24}?(?:总市值|市值|总股本)[^。；;\n]{0,12}?(?P<p>\d+(?:\.\d+)?)\s*%"
)


def _to_yuan(num: float, unit: str | None) -> float | None:
    u = unit or ""
    if u == "万亿":
        return num * 1e12
    if u in ("亿元", "亿"):
        return num * 1e8
    if u in ("万元", "万"):
        return num * 1e4
    if not u:
        # 裸数字不可靠
        return None
    return num


def extract_materiality(text: str) -> dict[str, Any]:
    """从正文粗抽金额与占比。"""
    out: dict[str, Any] = {
        "deal_value_text": None,
        "deal_value": None,
        "pct_of_revenue": None,
        "pct_of_nav": None,
        "pct_of_mktcap": None,
    }
    if not text:
        return out

    m = _PCT_REV_RE.search(text)
    if m:
        out["pct_of_revenue"] = float(m.group("p")) / 100.0
    m = _PCT_NAV_RE.search(text)
    if m:
        out["pct_of_nav"] = float(m.group("p")) / 100.0
    m = _PCT_MKT_RE.search(text)
    if m:
        out["pct_of_mktcap"] = float(m.group("p")) / 100.0

    # 取文中较大的「亿」级金额作为 deal_value 候选
    best: tuple[float, str] | None = None
    for m in _AMOUNT_RE.finditer(text[:8000]):
        unit = m.group("unit")
        try:
            num = float(m.group("num"))
        except ValueError:
            continue
        yuan = _to_yuan(num, unit)
        if yuan is None or yuan < 1e7:
            continue
        label = m.group(0).strip()
        if best is None or yuan > best[0]:
            best = (yuan, label)
    if best:
        out["deal_value"] = best[0]
        out["deal_value_text"] = best[1]
    return out


def fetch_and_extract(
    *,
    announcement_id: str,
    pdf_url: str,
    max_chars: int = 18000,
    ttl_sec: float | None = None,
) -> dict[str, Any]:
    """下载（或命中缓存）并抽取文本。过期文件会重新下载；批量清理见 cleanup_expired_pdfs。"""
    url = str(pdf_url or "").strip()
    if not url:
        return {"ok": False, "error": "无 pdf_url", "text": "", "materiality": {}}

    ttl = float(ttl_sec) if ttl_sec is not None else pdf_ttl_seconds()
    safe_id = re.sub(r"[^\w\-]+", "_", announcement_id)[:120] or "unknown"
    path = cache_dir() / f"{safe_id}.pdf"
    now = time.time()
    reuse = False
    if path.exists() and path.stat().st_size > 64:
        age = now - path.stat().st_mtime
        if ttl > 0 and age < ttl:
            reuse = True
        else:
            # 过期：删掉再下，避免残缺旧文件占位
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
    if not reuse:
        try:
            _download(url, path)
        except (urllib.error.URLError, TimeoutError, OSError, RuntimeError) as e:
            return {"ok": False, "error": f"下载失败: {e}", "text": "", "materiality": {}}

    try:
        text = extract_text_from_pdf(path, max_chars=max_chars)
    except Exception as e:
        return {"ok": False, "error": str(e), "text": "", "materiality": {}}

    if not text.strip():
        return {"ok": False, "error": "正文为空（可能是扫描件）", "text": "", "materiality": {}}

    mat = extract_materiality(text)
    return {"ok": True, "error": None, "text": text, "materiality": mat, "cache_path": str(path)}
