# 自定义版面 — 开发计划

> 权威设计：[`custom-workspaces.md`](./custom-workspaces.md)  
> 代码落点：`apps/stock-dashboard/src/pages/Workspaces` + 扩展 `pages/Dashboard/portal`  
> 构建：`./scripts/build_dashboard.sh` → `web/static/dashboard`

---

## 1. 拍板

| # | 决策 | 选择 |
|---|------|------|
| 1 | 与总览关系 | **复用** PortalCanvas / Catalog / 数据拉取；**独立** storage |
| 2 | 全屏方式 | 路由根级 `/workspaces/:id`，**不**包 `Layout` |
| 3 | 管理入口 | 侧栏展开 + `/workspaces` 管理页 |
| 4 | 持久化 | `localStorage` key `stock-dashboard:custom-workspaces:v1` |
| 5 | iframe | **一期必做** `embed.iframe` |
| 6 | 删光策略 | 禁止删除最后一套；至少保留一个空工作区 |
| 7 | 后端 | 不新开布局 API |

---

## 2. 任务拆解

### P0 — 文档

- [x] `docs/custom-workspaces.md`
- [x] `docs/dev-plan-custom-workspaces.md`（本文件）

### P1 — Catalog / iframe

- [x] `types.ts`：`PortalWidgetType` += `embed.iframe`；`PortalCatalogGroupId` += `embed`
- [x] `widgetCatalog.ts`：登记 iframe 默认尺寸与分组
- [x] `widgets/IframeWidget.tsx` + `renderWidget` 接入
- [x] `PortalCanvas`：支持 `onUpdateWidget`；iframe 配置入口

### P2 — 持久化 CRUD

- [x] `pages/Workspaces/useWorkspaces.ts`：load/save、create/rename/duplicate/delete、setLastOpened、updateActive layout
- [x] 默认空工作区「版面 1」

### P3 — 路由与页面

- [x] `router`：`/workspaces` 在 Layout 内；`/workspaces/:id` 独立根路由无 chrome
- [x] `WorkspaceView`：复用 Dashboard 数据层 + PortalCanvas + 悬浮条
- [x] `WorkspacesManage`：列表管理 UI
- [x] `Sidebar`：可展开「自定义版面」

### P4 — 构建验收

- [x] 构建通过
- [x] 手工路径：`/dashboard/workspaces`、`/dashboard/workspaces/<id>`

---

## 3. 手工验收

```text
http://127.0.0.1:8765/dashboard/workspaces
http://127.0.0.1:8765/dashboard/workspaces/<id>
```

1. 侧栏展开自定义版面 → 新建 → 进入全屏  
2. 编辑 → 添加自选 / iframe → 填 URL → 完成  
3. 管理页重命名、复制、删除  
4. 刷新页面布局仍在  
