# AI Agent — 开发计划

> 权威设计：[`ai-agent.md`](./ai-agent.md)  
> 代码落点：`web/agent/` + `apps/stock-dashboard/src/pages/Agent`  
> 构建：`./scripts/build_dashboard.sh` → `web/static/dashboard`

---

## 1. 拍板

| # | 决策 | 选择 |
|---|------|------|
| 1 | 权限默认 | `workspace_and_repo` **每轮 L2 全工具**（本机单用户） |
| 2 | 会话存储 | 前端 `localStorage`；工作区按 `sessionId` 落盘 |
| 3 | 模型 | 现有 `ai_provider_profile` active |
| 4 | 运行时 | FastAPI tool-calling + SSE |
| 5 | 自升级提交 | UI 人工验收后 `finalize`（可 push / 仅 commit） |
| 6 | 冒烟 | `scripts/agent_smoke_test.sh`（不杀现网进程） |

---

## 2. 任务拆解

### Phase 0–1（已完成）

- [x] 文档、入口、L0 只读工具、精选提示词、标的链接

### Phase 2 — Coding 工作区

- [x] `workspace_list/read/write` + 路径沙箱
- [x] `shell_run` allowlist
- [x] skill `coding_workspace`
- [x] 右侧产物面板

### Phase 3 — 自升级

- [x] `repo_*` + 写保护
- [x] `run_smoke_test` / `git_*` / `prepare_acceptance`
- [x] 验收 API + UI「通过并 push / 仅 commit / 驳回」
- [x] skill `self_upgrade` + 精选提示词

### 验收

- [x] `./scripts/build_dashboard.sh`
- [x] 工具单测：工作区写入、禁 .env、禁危险 shell
- [ ] 浏览器：工作区写 README、自升级演示后点验收（勿在未确认时 push）

---

## 3. 手工路径

```text
http://127.0.0.1:8765/dashboard/agent
```

1. 「工作区写一份说明」→ 右侧出现产物路径  
2. 「本仓库自升级（小改动）」→ smoke → 验收条 → 可先点「仅 commit」或「驳回」  
3. 查库 / 标的链接仍可用  
