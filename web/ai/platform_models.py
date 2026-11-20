"""平台 × 模型 两层配置。

一个平台只登记一次 base_url / api_key，下面挂多个模型；
调用方用 ref = "platform_id/model_id" 引用，无需重复填写 key。

存储：data/ai_platforms.json（MEOSTOCK_AI_PLATFORMS_FILE 可覆盖）。
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import tempfile
import threading
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
REF_SEP = "/"

PRESETS = {
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "api_style": "openai",
        "models": ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    },
    "openai_compatible": {
        "label": "OpenAI 兼容网关",
        "base_url": "",
        "api_style": "openai",
        "models": [],
    },
    "anthropic": {
        "label": "Anthropic",
        "base_url": "https://api.anthropic.com",
        "api_style": "anthropic",
        "models": ["claude-sonnet-4-5", "claude-haiku-4-5"],
    },
    "deepseek": {
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "api_style": "openai",
        "models": ["deepseek-chat", "deepseek-reasoner"],
    },
    "dashscope": {
        "label": "阿里云百炼",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api_style": "openai",
        "models": ["qwen-max", "qwen-plus", "qwen-turbo"],
    },
    "moonshot": {
        "label": "Moonshot Kimi",
        "base_url": "https://api.moonshot.cn/v1",
        "api_style": "openai",
        "models": ["moonshot-v1-128k"],
    },
    "zhipu": {
        "label": "智谱 GLM",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "api_style": "openai",
        "models": ["glm-4.5", "glm-4-flash"],
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "api_style": "openai",
        "models": ["openai/gpt-4o"],
    },
    "ollama": {
        "label": "本地 Ollama",
        "base_url": "http://127.0.0.1:11434/v1",
        "api_style": "openai",
        "models": ["qwen2.5:14b"],
    },
}

MODEL_FIELDS = (
    "id",
    "name",
    "context_window",
    "max_output_tokens",
    "temperature",
    "enabled",
    "default",
    "notes",
)
PLATFORM_FIELDS = (
    "id",
    "name",
    "protocol",
    "base_url",
    "api_key",
    "enabled",
    "notes",
    "models",
)

_LOCK = threading.RLock()
_SLUG = re.compile(r"[^a-z0-9]+")


def config_path() -> Path:
    raw = os.environ.get("MEOSTOCK_AI_PLATFORMS_FILE")
    if raw:
        return Path(raw).expanduser()
    data_dir = os.environ.get("MEOSTOCK_DATA_DIR")
    base = Path(data_dir).expanduser() if data_dir else (_REPO_ROOT / "data")
    return base / "ai_platforms.json"


def _int(value, default=0):
    try:
        num = int(value)
    except (TypeError, ValueError):
        return default
    return num if num >= 0 else default


def _float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def slugify(value, fallback="platform"):
    text = _SLUG.sub("-", (value or "").strip().lower()).strip("-")
    return text or fallback


def preset_for(protocol):
    return PRESETS.get(str(protocol or "").strip()) or {}


def normalize_model(model):
    src = model or {}
    out = {
        "id": "",
        "name": "",
        "context_window": 0,
        "max_output_tokens": 0,
        "temperature": None,
        "enabled": True,
        "default": False,
        "notes": "",
    }
    for key in MODEL_FIELDS:
        if key in src:
            out[key] = src[key]
    out["id"] = str(out.get("id") or "").strip()
    out["name"] = str(out.get("name") or out["id"]).strip()
    out["context_window"] = _int(out.get("context_window"))
    out["max_output_tokens"] = _int(out.get("max_output_tokens"))
    out["temperature"] = _float(out.get("temperature"))
    out["enabled"] = bool(out.get("enabled", True))
    out["default"] = bool(out.get("default", False))
    out["notes"] = str(out.get("notes") or "").strip()
    return out


def normalize_platform(platform):
    src = platform or {}
    out = {
        "id": "",
        "name": "",
        "protocol": "openai",
        "base_url": "",
        "api_key": "",
        "enabled": True,
        "notes": "",
        "models": [],
    }
    for key in PLATFORM_FIELDS:
        if key in src:
            out[key] = src[key]
    out["name"] = str(out.get("name") or "").strip()
    out["protocol"] = str(out.get("protocol") or "openai").strip() or "openai"
    out["base_url"] = str(out.get("base_url") or "").strip().rstrip("/")
    out["api_key"] = str(out.get("api_key") or "").strip()
    out["enabled"] = bool(out.get("enabled", True))
    out["notes"] = str(out.get("notes") or "").strip()
    out["id"] = str(out.get("id") or "").strip() or slugify(out["name"] or out["protocol"])

    models, seen = [], set()
    for raw in out.get("models") or []:
        if not isinstance(raw, dict):
            continue
        item = normalize_model(raw)
        if not item["id"] or item["id"] in seen:
            continue
        seen.add(item["id"])
        models.append(item)
    if models and not any(m["default"] for m in models):
        models[0]["default"] = True
    out["models"] = models
    if not out["base_url"]:
        out["base_url"] = str(preset_for(out["protocol"]).get("base_url") or "")
    return out


def _empty():
    return {"version": 1, "platforms": [], "updated_at": None}


def _read():
    path = config_path()
    if not path.exists():
        return _empty()
    try:
        raw = json.loads(path.read_text(encoding="utf-8") or "{}")
    except (OSError, ValueError):
        return _empty()
    if not isinstance(raw, dict):
        return _empty()
    platforms = raw.get("platforms")
    if not isinstance(platforms, list):
        platforms = []
    return {
        "version": 1,
        "platforms": [normalize_platform(p) for p in platforms if isinstance(p, dict)],
        "updated_at": raw.get("updated_at"),
    }


def _write(doc):
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "platforms": [normalize_platform(p) for p in doc.get("platforms") or []],
        "updated_at": _dt.datetime.now().isoformat(timespec="seconds"),
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    fd, tmp = tempfile.mkstemp(prefix=".ai_platforms.", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def build_ref(platform_id, model_id):
    return "{}{}{}".format(platform_id, REF_SEP, model_id)


def parse_ref(ref):
    text = str(ref or "").strip()
    if not text:
        return "", ""
    if REF_SEP not in text:
        return "", text
    pid, _, mid = text.partition(REF_SEP)
    return pid.strip(), mid.strip()


def list_platforms(include_disabled=True):
    with _LOCK:
        platforms = _read()["platforms"]
    if include_disabled:
        return platforms
    return [p for p in platforms if p.get("enabled")]


def get_platform(platform_id):
    pid = str(platform_id or "").strip()
    if not pid:
        return None
    for platform in list_platforms(True):
        if platform["id"] == pid:
            return platform
    return None


def list_models(include_disabled=True):
    out = []
    for platform in list_platforms(True):
        if not include_disabled and not platform.get("enabled"):
            continue
        style = preset_for(platform.get("protocol", "")).get("api_style", "openai")
        for model in platform.get("models") or []:
            if not include_disabled and not model.get("enabled"):
                continue
            item = dict(model)
            item["ref"] = build_ref(platform["id"], model["id"])
            item["platform_id"] = platform["id"]
            item["platform_name"] = platform.get("name") or platform["id"]
            item["protocol"] = platform.get("protocol")
            item["api_style"] = style
            item["available"] = bool(platform.get("enabled")) and bool(model.get("enabled"))
            out.append(item)
    return out


def _merge(platform, model):
    preset = preset_for(platform.get("protocol", ""))
    return {
        "ref": build_ref(platform["id"], model["id"]),
        "platform_id": platform["id"],
        "platform_name": platform.get("name") or platform["id"],
        "protocol": platform.get("protocol") or "openai",
        "api_style": preset.get("api_style", "openai"),
        "base_url": platform.get("base_url") or "",
        "api_key": platform.get("api_key") or "",
        "model": model["id"],
        "model_name": model.get("name") or model["id"],
        "context_window": model.get("context_window") or 0,
        "max_output_tokens": model.get("max_output_tokens") or 0,
        "temperature": model.get("temperature"),
        "enabled": bool(platform.get("enabled")) and bool(model.get("enabled")),
    }


def resolve(ref):
    """ref -> 完整调用配置；兼容只写 model_id 的旧用法。"""
    platform_id, model_id = parse_ref(ref)
    if platform_id:
        platform = get_platform(platform_id)
        if not platform:
            return None
        model = next((m for m in platform.get("models") or [] if m["id"] == model_id), None)
        return _merge(platform, model) if model else None
    if not model_id:
        return None
    matches = [m for m in list_models(True) if m["id"] == model_id]
    if not matches:
        return None
    chosen = next((m for m in matches if m.get("default")), matches[0])
    platform = get_platform(chosen["platform_id"])
    if not platform:
        return None
    model = next((m for m in platform.get("models") or [] if m["id"] == model_id), None)
    return _merge(platform, model) if model else None


def default_model_ref():
    models = list_models(False)
    for item in models:
        if item.get("default"):
            return item["ref"]
    return models[0]["ref"] if models else None


def upsert_platform(payload):
    platform = normalize_platform(payload)
    with _LOCK:
        doc = _read()
        platforms = doc["platforms"]
        idx = next((i for i, p in enumerate(platforms) if p["id"] == platform["id"]), None)
        if idx is None:
            existing = set(p["id"] for p in platforms)
            base, seq = platform["id"], 2
            while platform["id"] in existing:
                platform["id"] = "%s-%d" % (base, seq)
                seq += 1
            platforms.append(platform)
        else:
            platforms[idx] = platform
        doc["platforms"] = platforms
        _write(doc)
    return platform


def delete_platform(platform_id):
    with _LOCK:
        doc = _read()
        before = len(doc["platforms"])
        doc["platforms"] = [p for p in doc["platforms"] if p["id"] != platform_id]
        if len(doc["platforms"]) == before:
            return False
        _write(doc)
    return True


def add_model(platform_id, model):
    platform = get_platform(platform_id)
    if not platform:
        return None
    new_id = str((model or {}).get("id") or "").strip()
    if not new_id:
        return None
    models = [m for m in platform.get("models") or [] if m["id"] != new_id]
    models.append(normalize_model(model))
    platform["models"] = models
    return upsert_platform(platform)


def remove_model(platform_id, model_id):
    platform = get_platform(platform_id)
    if not platform:
        return None
    platform["models"] = [m for m in platform.get("models") or [] if m["id"] != model_id]
    return upsert_platform(platform)


def set_default(ref):
    platform_id, model_id = parse_ref(ref)
    platform = get_platform(platform_id)
    if not platform:
        return False
    found = False
    for model in platform.get("models") or []:
        model["default"] = model["id"] == model_id
        found = found or model["default"]
    if not found:
        return False
    upsert_platform(platform)
    return True


def _mask(key):
    key = str(key or "")
    if not key:
        return ""
    if len(key) <= 8:
        return "***"
    return key[:4] + "***" + key[-4:]


def snapshot(mask_key=True):
    platforms = []
    for platform in list_platforms(True):
        item = dict(platform)
        key = str(item.get("api_key") or "")
        item["api_key_masked"] = _mask(key)
        item["has_api_key"] = bool(key)
        if mask_key:
            item["api_key"] = ""
        item["model_count"] = len(item.get("models") or [])
        platforms.append(item)
    return {
        "platforms": platforms,
        "models": list_models(True),
        "default_ref": default_model_ref(),
        "presets": PRESETS,
        "path": str(config_path()),
    }


def seed_from_legacy(legacy):
    """把旧的单模型配置（base_url/api_key/model）导入成一个平台。"""
    legacy = legacy or {}
    base_url = str(legacy.get("base_url") or "").strip()
    model_id = str(legacy.get("model") or legacy.get("default_model") or "").strip()
    if not base_url and not model_id:
        return None
    protocol = "openai_compatible" if base_url else "openai"
    platform = {
        "id": slugify(legacy.get("name") or "imported", "imported"),
        "name": legacy.get("name") or "导入的平台",
        "protocol": protocol,
        "base_url": base_url,
        "api_key": legacy.get("api_key") or "",
        "enabled": True,
        "notes": "由旧版单模型配置导入",
        "models": [{"id": model_id, "default": True}] if model_id else [],
    }
    return upsert_platform(platform)
