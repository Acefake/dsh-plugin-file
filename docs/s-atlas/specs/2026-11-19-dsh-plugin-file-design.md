# dsh-plugin-file 设计规格

日期：2026-11-19
状态：已确认设计，待实现

## 1. 问题

DSH 目前写一个插件必须：TypeScript 包 + `cordis.patch.yml` + Host/Client 两半 + 构建，然后 `install_bundle`。Claude Code 的插件形态是纯文件：一个目录放 `commands/*.md`、`agents/*.md`、`skills/`、`hooks/hooks.json`，放进配置目录就能用。

目标是让 DSH 拥有同等的门槛：**作者只写 Markdown 和 JSON，永不碰 TypeScript 和构建。**

## 2. 已核实的事实（本设计的前提）

这些不是猜测，是对当前安装（DSH profile `desktop`）查证的结果。

| 事实 | 来源 |
|---|---|
| `ctx.skills` 有 `registerProvider(create)` 和 `register(skill)` 两个入口；provider 带 `invalidate()` | `dsh-skill` README §What the registry gives you |
| 技能的 `userInvocable` 决定是否出现在斜杠建议中，`modelInvocable` 决定是否给模型 | 同上，invocation policy 表 |
| `/name` 由 `dsh-tool-skill` 的 pre-step 监听器拦截，**注入 `<skill_content>`，不经过 `ctx.commands`** | `dsh-tool-skill` README §Invocation boundary |
| `dsh-client-ui-skill` 用 `skills/list` Remote 填充 `/` 建议列表 | `dsh-client-ui-skill` README §What the source offers |
| **名字与 host command 冲突时，该行判给 host command，永远不是 prompt** | `dsh-client-ui-skill` README §Use this package |
| `ctx.agentPresets.register(definition)` 可运行时注册预设，返回 disposer | Cordis Inspect `Service.listService` |
| 预设是"一次激活、按版本共享"，**已存在会话保留启动时的版本** | `dsh-plugin-manager` README §Use this package |
| `ctx.tools.restrict({allow,deny})` 只作用于**调用方 scope 的全局工具**，不影响 scoped 注册 | Cordis Inspect `Service.tools` |
| `dsh-hooks-claude-code` 已能直接运行 Claude Code 的 hooks 配置 | `references/packages.md` |
| `plugin_manager.install_bundle` 支持 git/GitHub spec，带 `git ls-remote` 预检 | `dsh-plugin-manager` README |
| `updateBundle` 的 git 模式**只认钉死 40 位完整 commit 的 spec** | 同上，§listBundles |
| `dsh-plugin-market` 读用户配置的索引 URL，条目支持钉 commit + `path:` | `dsh-plugin-market` README |

### 由事实推出的两条硬约束

**约束 A：`commands/` 不能注册成 host command。**
`/name` 的名字冲突判给 host command，而 host command 的 `CommandResult` 只有 `success/error`，无法把展开后的 prompt 发给模型。若注册成命令，Claude Code 的 `commands/*.md` 语义会静默失效。因此 `commands/` 与 `skills/` 合并，统一走 skill 注册。

**约束 B：热更新对已存在会话无效的是预设层，不是技能层。**
技能注册表没有 TTL 但有 `invalidate()`，改文件即时生效（已实测：造一个 skill 目录立刻出现在目录中，删掉立刻消失）。预设则是一次激活按版本共享，改 `agents/*.md` 只影响新会话。

## 3. 目标与非目标

### 目标
1. `~/.dsh/plugins/<name>/` 下一个目录 = 一个插件包，放进去就生效。
2. 四类内容自动分发：`skills/`、`commands/`、`agents/`、`hooks/hooks.json`。
3. 直接读取 Claude Code 的 `.claude-plugin/plugin.json` 目录结构。
4. 文件改动热更新，不需要重启（预设层除外，见约束 B）。
5. 发布 `plugins-index.json`，可配成 `dsh-plugin-market` 的索引 URL。
6. 从 GitHub 安装与按 commit 更新，复用 `plugin_manager`，不自己写安装器。

### 非目标
- 不实现 npm 发布流程（索引条目可以指向 git）。
- 不实现 Claude Code 的 `allowed-tools` 之外的复杂权限语义。
- 不实现跟随分支/tag 自动更新（`updateBundle` 不支持，见事实表）。
- 不提供 UI 编辑界面（先用文件编辑）。

## 4. 数据结构

先定类型，再谈逻辑。

```ts
/** 一个文件插件的清单。plugin.json 或 .claude-plugin/plugin.json。 */
interface FilePluginManifest {
  name: string            // 必填，kebab-case，同时是目录名
  description?: string
  version?: string
  // 四类内容的根，相对插件目录；不写则用默认目录名
  skills?: string         // 默认 'skills'
  commands?: string       // 默认 'commands'
  agents?: string         // 默认 'agents'
  hooks?: string          // 默认 'hooks/hooks.json'
}

/** 磁盘上一个已发现的插件。 */
interface DiscoveredPlugin {
  name: string
  dir: string
  manifest: FilePluginManifest
  /** 与 plugin.json 同源，供预览用 */
  source: 'plugin-json' | 'claude-plugin-json'
}

/** 一个待注册的条目，四类内容解析后都归一到这里。 */
type ResolvedEntry =
  | { kind: 'skill'; name: string; description: string; whenToUse?: string
      modelInvocable: boolean; userInvocable: boolean; body: string; path: string }
  | { kind: 'agent'; name: string; description: string; body: string
      tools?: { allow?: string[]; deny?: string[] }; path: string }
  | { kind: 'hooks'; path: string; config: unknown }
```

**归一化的理由**：`commands/*.md` 解析后产出的就是 `kind: 'skill'`（约束 A）。这样解析器只需两条路径（markdown 条目、hooks JSON），而不是四条。

## 5. 四层映射

| 来源 | 解析为 | 注册到 | 热更新 |
|---|---|---|---|
| `skills/*/SKILL.md`、`skills/*.md` | `skill` | `ctx.skills.registerProvider()` | ✅ 调 `invalidate()` |
| `commands/*.md` | `skill` + `userInvocable: true` | 与上同一 provider | ✅ 同上 |
| `agents/*.md` | `agent` | `ctx.agentPresets.register()` | ⚠️ 仅新会话 |
| `hooks/hooks.json` | `hooks` | 交给 `dsh-hooks-claude-code` 桥 | ✅ 重新挂载 |

### 5.1 skill / command 合并

一个插件贡献**一个** provider，其 `list()` 返回该插件所有 skill 与 command 的候选。`get(candidate)` 重新读文件正文（与 `dsh-skill-filesystem` 的 catalog/body 分离一致）。

command 与 skill 的唯一差别是 `userInvocable` 默认值：command 默认 `true`，skill 默认按 frontmatter（缺省 `true`，与 DSH 现有行为一致）。

frontmatter 接受字段：`name`、`description`、`whenToUse`、`disable-model-invocation`、`user-invocable`。与 Claude Code 及 `dsh-skill-filesystem` 一致。

### 5.2 agents

`agents/*.md` 的 frontmatter：`name`、`description`、可选 `tools`（字符串数组，Claude Code 的 `allowed-tools` 等价物）。

注册为一个 preset：

```ts
{
  id: `file-${plugin.name}-${agent.name}`,   // 必须 kebab-case
  name: agent.name,
  description: agent.description,
  plugins: [
    { id: 'persona', name: '@deepseek-ai/dsh-persona',
      config: { prefix: agent.body } },
    { id: 'tools-restrict', name: /* 如需要限制，注册一个人工包装 */ }
  ]
}
```

工具限制的处理要说明清楚：`ctx.tools.restrict()` 只影响调用方 scope，而 preset 的作用域是会话级别，与 `restrict` 的调用上下文不同。**实现时先不接 `tools` 字段**，把 `tools` 解析出来但只作为元数据保留，避免做出一个看起来能用实则无效的开关。等确认了 preset 内工具限制的可行路径再接。这是刻意留白，不是遗漏。

### 5.3 hooks

`hooks/hooks.json` 原样交给 `dsh-hooks-claude-code`。本插件只负责定位文件并触发挂载，不解释 hook 语义。

## 6. 数据流

```
启动 / 文件变更
  ↓
扫描 ~/.dsh/plugins/*/
  ↓
读 plugin.json（回退 .claude-plugin/plugin.json）
  ↓
解析四类内容 → ResolvedEntry[]
  ↓
分发：
  skills+commands → registerProvider（一个 provider/插件）
  agents          → agentPresets.register（每个 agent 一条）
  hooks           → hooks 桥挂载
  ↓
记录 disposers，卸载时按逆序释放
```

## 7. 热更新语义

- 监听 `~/.dsh/plugins` 深度 2（插件目录 + 一层内容）。
- 相关变更（新增/删除插件目录、`plugin.json` 变更、`skills`/`commands` 下条目增删、`agents` 下条目增删）合并成一个微任务批次处理。
- skill 层：调 provider 的 `invalidate()`，注册表下次读取时重新发现。
- command 层：同 skill 层。
- agent 层：**释放旧 preset、注册新 preset**，并明确记录"已存在会话不受影响"。
- hooks 层：卸载旧挂载、重新挂载。
- 正文编辑（非 frontmatter）不触发重新发现——正文每次 `get()` 重读。

## 8. 安装与更新

不写安装器，复用现有能力。

**安装**：
```
plugin_manager install_bundle target=<git spec>
```
支持 `github:user/repo#<40位sha>` 与绝对路径目录。

**更新**：只有两种合法形态。

| 形态 | 做法 |
|---|---|
| 索引驱动 | `plugins-index.json` 维护版本 → commit 映射，用户从 Discover 页更新 |
| 钉 commit 直装 | 用户装 `github:user/repo#<sha>`，发新版时给新 sha |

分支/tag 自动更新不可行，因为 `updateBundle` 会拒绝无法回滚的 spec。绕过它等于让更新失败时删除可用版本。

**索引文件**：`plugins-index.json` 放在本仓库根，格式对齐 `dsh-plugin-market` 的索引 schema。

## 9. 错误处理

| 情况 | 行为 |
|---|---|
| 插件目录无清单 | 跳过并 warn，不报错 |
| 清单 JSON 非法 | 跳过该插件，warn 带路径 |
| `name` 与目录名不符 | 以目录名为准，warn |
| 条目 frontmatter 非法 | 跳过该条目，warn；同插件其他条目照常 |
| 同名条目冲突（跨插件） | 依赖注册表的 first-wins，本插件不干预 |
| 根目录不存在 | 正常空状态，不报错 |

失败一律降级为 warn + 跳过，不让一个坏插件拖垮整个加载器。理由是这些内容来自用户手写文件，容错比严格更重要。

## 10. 测试

按 `test-strategy`，测试点集中在纯函数解析器。

| 层 | 测什么 | 工具 |
|---|---|---|
| 单元 | 清单解析、frontmatter 解析、四类分发决策 | node:test |
| 单元 | command → skill 的 `userInvocable` 覆盖 | node:test |
| 单元 | 错误降级路径（坏 JSON、坏 frontmatter） | node:test |
| 集成 | provider 的 `list()`/`get()` 返回正确形状 | node:test + 临时目录 |
| 手工 | 装进 profile 后 `/name` 真能触发技能注入 | 真实会话 |

**不测**：Chokidar 的实际文件事件（依赖 OS，用假 fs 注入代替）、preset 的会话隔离（走 DSH 自己的测试）。

## 11. 交付物

1. `packages/dsh-plugin-file/` — 插件包
2. `plugins-index.json` — 索引
3. `README.md` — 作者指南，含从 Claude Code 迁移的对照表
4. 一份最小样例插件 `examples/hello-plugin/`

## 12. 刻意留白

- `agents/*.md` 的 `tools` 字段暂不生效（见 5.2）。
- 不做 `/` 菜单里按插件分组（DSH 现有 ranker 不支持）。
- 不做索引的自动刷新，依赖 `dsh-plugin-market` 的 `cacheTtlMs`。

## 13. 实现顺序

每步停在可验证的状态。

1. 清单 + frontmatter 解析器（纯函数，先写测试）
2. provider 实现（skill + command 合并）
3. agent preset 注册
4. hooks 桥接
5. watcher 与热更新
6. 清单包（package.json + cordis.patch.yml + 图标 + locale）
7. 索引文件
8. 装进 profile 验证
