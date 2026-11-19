# AI 模型配置（设置页）

> 多平台档案 + 热切换；Key 落本机 SQLite，脱敏展示。  
> 范围：DeepSeek 预设 + 任意 OpenAI 兼容端点。

---

## 1. 交互

设置页「AI 模型」卡片：

1. **状态条**：当前生效平台 · 模型 · 连通状态  
2. **档案列表**：点击行切换「使用中」；编辑 / 删除  
3. **编辑表单**：平台（DeepSeek / OpenAI 兼容）、名称、Base URL、模型、API Key、高级（max_tokens / 超时）  
4. **测试连通**：可对草稿或已保存档案探测，不强制先保存

全站（K 线聊天、财经日历评级等）共用一个「当前生效」配置。

---

## 2. 存储

表 `ai_provider_profile`（`data/quote_cache.db`）：

| 字段 | 说明 |
|------|------|
| id | UUID |
| name | 显示名 |
| provider | `deepseek` \| `openai_compat` |
| base_url / model / api_key | 调用参数（Key 明文仅本机） |
| max_tokens / timeout_sec | 可选 |

`cache_config`：

- `ai_active_profile_id`：当前生效档案  
- `ai_last_health_json`：最近探测快照（ok / latency / error / at）

API **永不返回完整 Key**，仅 `api_key_masked` + `has_api_key`。

### 启动优先级

1. 库中 active 档案且有 Key  
2. 库无档案时，用 `.env` 的 `DEEPSEEK_*` 自动导入一条并设为 active  
3. 否则未配置

正式配置以设置页为准；`.env` 仅作冷启动种子。

---

## 3. HTTP API

| 路径 | 说明 |
|------|------|
| `GET /api/ai/config` | 当前配置摘要（无 Key）+ health 快照 + 档案列表摘要 |
| `GET /api/ai/profiles` | 全部档案（脱敏） |
| `POST /api/ai/profiles` | 新建 |
| `PATCH /api/ai/profiles/{id}` | 更新（空 `api_key` = 不改） |
| `DELETE /api/ai/profiles/{id}` | 删除（使用中不可删） |
| `POST /api/ai/profiles/{id}/activate` | 设为当前生效 |
| `POST /api/ai/test` | 测连通（body 可带草稿字段或 `profile_id`） |
| `GET /api/ai/health` | 与 config 对齐的连通摘要 |

DeepSeek 专属 tools（联网搜索等）仅在 `provider=deepseek` 时启用。

---

## 4. 安全边界

- Key 与 `.env` 同属本机信任边界，不加密、不上云。  
- 前端只见掩码；更换 Key 需显式输入新值。  
- 本机多用户/共享机器时注意 DB 文件权限。
