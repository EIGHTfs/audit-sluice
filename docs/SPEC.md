# SPEC 摘录（审计包）

> 本包只保留与审计实现直接相关的契约章节；完整 SPEC 随宿主插件（dsh-git-push）维护。

## 十一、审计 UI 契约

> 审计 Tab 已于 2.20.15 移出构建（分片归档在 `lib/client-parts/audit/`）。本契约用于**将来接回时**按可插拔方式实现，
> 使 UI 不绑定任何一个引擎的实现细节。本阶段**只定义契约，不实施 UI**。

```
lib/audit-ui-sdk/
├── contract.js   契约实现（版本号 + 键常量 + defineAuditPanel 校验，构建期用）
└── index.js      唯一导出面（实现只能从这里 import）
```

**唯一导出面 = 恰好 6 个符号**（多一个都会被 `test-audit-ui-contract.mjs` 判红）：

```
AUDIT_UI_CONTRACT_VERSION    契约版本（破坏性改动 +1）
AUDIT_PANEL_ID_PATTERN       meta.id 的合法形态
AUDIT_PANEL_DATA_KEYS        data 组键：summary / quality / findings / ruleSlots
AUDIT_PANEL_ACTION_KEYS      actions 组键：reload / toggleRule / editWeight / toggleDisabled
AUDIT_PANEL_STATE_KEYS       state 组键：loading / error / auditEnabled / auditScanScope
defineAuditPanel             校验 + 深冻结
```

**契约形状**：`meta:{id,name,contractVersion}`（`id` 形如 `/^[a-z][a-z0-9-]{1,31}$/`）+
`Panel:(props)=>vnode` + 可选 `styles?:string`、`setup?:(ctx)=>void|(()=>void)`。

**props**：`data:{summary,quality,findings,ruleSlots}`、`actions:{reload,toggleRule,editWeight,toggleDisabled}`、
`state:{loading,error,auditEnabled,auditScanScope}`。

**字段语义**：`data` 里的字段与**引擎返回同名同构，不做二次改名或裁剪**（如 `quality` 是引擎返回的整个对象，不是只留 `{score,level}`）——契约负责说清结构，不替引擎裁剪；否则引擎加字段就要动契约版本。

**三条硬约束**：① 实现只能从 `lib/audit-ui-sdk` 唯一入口 import；② 校验只覆盖构建期一定能判的部分（形状与版本），
不猜作者意图；③ 契约破坏性改动 `contractVersion +1`，构建期拒绝按旧契约写的实现。
