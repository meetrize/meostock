# AI 模型配置（设置页）

> 平台 + 模型两层结构；一套 Base URL / Key 可挂多个模型。  
> Key 落本机 SQLite，脱敏展示。范围：DeepSeek 预设 + 任意 OpenAI 兼容端点。

---

## 1. 信息架构

| 层 | 表 | 说明 |
|----|-----|------|
| **平台** | `ai_platform` | provider + base_url + api_key（填一次） |
| **模型** | `ai_provider_profile` | 可激活单元；`platform_id` 非空时继承平台 URL/Key |

**使用中** = 选中某一个模型（全站共用），不是选中整个平台。

`platform_id` 为空的历史档案仍可用，展示在「独立配置（未归入平台）」，可一键归入/升为平台。

---

## 2. 交互

设置页「AI 模型」卡片：

1. **状态条**：当前生效平台类型 · 模型 · 连通状态  
2. **平台卡片**：头（名称 / URL / Key 掩码）+ 测试 / 编辑 / 删除  
3. **模型列表**（嵌在平台下）：点击设为使用中；编辑 / 删除  
4. **添加模型**：仅填模型名（可选手动）  
5. **从平台拉取**：请求上游 `/models` → 多选 → 确认批量添加（已添加项禁用）  
6. **添加平台**：可勾选「同时添加首个模型」（合并配置）；取消勾选则先只建平台  

拉取失败时：DeepSeek 等可回落本地预设列表供勾选；也可改手动添加。

---

## 3. 存储

### `ai_platform`

| 字段 | 说明 |
|------|------|
| id | UUID |
| name | 显示名 |
| provider | `deepseek` \| `openai_compat` |
| base_url / api_key | 调用参数（Key 明文仅本机） |

### `ai_provider_profile`

| 字段 | 说明 |
|------|------|
| id | UUID |
| name / model | 显示名与模型 ID |
| platform_id | 非空 → 继承平台；空 → 本行自带 base_url/api_key |
| provider / base_url / api_key | 独立档案或快照字段 |
| max_tokens / timeout_sec | 可选 |

`cache_config`：

- `ai_active_profile_id`：当前生效模型  
- `ai_last_health_json`：最近探测快照  

API **永不返回完整 Key**，仅 `api_key_masked` + `has_api_key`。

### 启动优先级

1. 库中 active 模型且能解析出 Key  
2. 库无档案时，用 `.env` 的 `DEEPSEEK_*` 自动建平台 + 默认模型并设为 active  
3. 否则未配置  

---

## 4. HTTP API

| 路径 | 说明 |
|------|------|
| `GET /api/ai/config` | 摘要 + health + `platforms[]`（嵌套 models）+ `standalone` + `profiles` |
| `GET/POST /api/ai/platforms` | 列出 / 新建（body 可带 `model` 合并首个模型） |
| `PATCH/DELETE /api/ai/platforms/{id}` | 更新 / 删除（有下属模型时禁止删） |
| `POST /api/ai/platforms/{id}/models/discover` | 拉取上游模型列表（标注 `already_added`） |
| `GET /api/ai/platforms/{id}/balance` | DeepSeek 专用：查账户余额（官方 `GET /user/balance`） |
| `GET /api/ai/profiles` | 全部模型档案（脱敏，含 platform_id） |
| `POST /api/ai/profiles` | 新建（可带 `platform_id`，此时可省略 url/key） |
| `POST /api/ai/profiles/batch` | 批量：`{ platform_id, models[] }` |
| `PATCH /api/ai/profiles/{id}` | 更新 |
| `DELETE /api/ai/profiles/{id}` | 删除（使用中不可删） |
| `POST /api/ai/profiles/{id}/activate` | 设为当前生效 |
| `POST /api/ai/profiles/{id}/attach` | 独立档案归入平台（可自动匹配或新建平台） |
| `POST /api/ai/test` | 测连通（支持 `profile_id` / `platform_id` / 草稿字段） |
| `GET /api/ai/health` | 连通摘要 |

DeepSeek 专属 tools（联网搜索等）仅在 `provider=deepseek` 时启用。

---

## 5. 安全边界

- Key 与 `.env` 同属本机信任边界，不加密、不上云。  
- 前端只见掩码；更换 Key 需显式输入新值。  
- 本机多用户/共享机器时注意 DB 文件权限。
