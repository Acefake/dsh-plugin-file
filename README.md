# dsh-plugin-file

用一个 Markdown 和 JSON 目录写 DeepSeek Harness 插件。不用 TypeScript，不用构建，不用打包工具。

```markdown
~/.dsh/plugins/hello/
  plugin.json
  skills/greeter/SKILL.md
  commands/summarize-change.md
  agents/reviewer.md
  hooks/hooks.json
```

放进去就行。`hello-greeter` 和 `/summarize-change` 下个会话就能用，`reviewer` 会出现在子代理预设里。

## 为什么做这个

DSH 的插件是包：一个 Cordis 入口、一个 `cordis.patch.yml`、常常还有 Client 半边，再加一次构建。对改动宿主行为的代码，这是对的形状；但对一段提示词、一份检查清单、一个评审流程来说，这是错的形状——而大多数插件实际上就是这些。

Claude Code 让「插件就是一个文件夹」这个形状流行起来。这个加载器给 DSH 同样的形状，但不另起一套系统：文件插件就是普通的技能、子代理、钩子，走 DSH 自己的注册表。

## 安装

DSH 只认四种输入：registry 名、本地目录、git 地址、tarball。下面每种都实测过。

**GitHub 链接**（钉 commit，可更新）：

```sh
dsh plugin --profile <profile> add "git+https://github.com/Acefake/dsh-plugin-file.git#<40位commit>&path:/packages/dsh-plugin-file"
```

**tarball**：

```sh
dsh plugin --profile <profile> add "/绝对路径/dsh-plugin-file-0.1.0.tgz"
```

**本地目录**：直接给绝对路径。

**zip**：DSH 不认 `.zip`，先转成 tarball：

```sh
node scripts/zip-to-tgz.mjs 你的插件.zip dist/
# 输出 dist/<名字>-<版本>.tgz，再按 tarball 的方式安装
```

也可以在插件页把 `https://raw.githubusercontent.com/Acefake/dsh-plugin-file/master/plugins-index.json` 配成索引，从 Discover 页安装。

## 更新

GitHub 安装只在索引钉了新 commit 时更新。原因是更新要先删掉旧版本，删了就必须能装回来——所以分支和 tag 不被接受。

改索引里的 `commit`，再从 Discover 页更新，或重新执行一次 `add`。

## 写插件

格式见 [`packages/dsh-plugin-file/docs/DETAIL.md`](packages/dsh-plugin-file/docs/DETAIL.md)，例子见 [`examples/hello-plugin`](examples/hello-plugin)。

两条先说清楚：

- **命令就是技能。** `commands/review.md` 变成 `/review`，不是注册成宿主命令。宿主命令会先占住名字，prompt 就永远到不了模型——那样等于什么都没做。
- **改子代理只对新会话生效。** 预设激活一次后由会话共享，改 `agents/*.md` 不会改写正在跑的对话。

## 目录

| 路径 | 作用 |
|---|---|
| `packages/dsh-plugin-file/src/parse.js` | frontmatter 和清单解析。纯函数。 |
| `packages/dsh-plugin-file/src/discover.js` | 目录扫描。只用 `node:fs`。 |
| `packages/dsh-plugin-file/src/index.js` | Cordis 插件：provider、预设、文件监听。 |
| `packages/dsh-plugin-file/client.js` | 侧边栏面板，中英双语。 |
| `packages/dsh-plugin-file/test/` | `node --test` 测试。 |
| `plugins-index.json` | 本仓库发布的插件索引。 |
| `scripts/validate-index.mjs` | 用 DSH 自己的校验器验证索引。 |
| `scripts/zip-to-tgz.mjs` | 把 zip 转成可安装的 tarball。 |
| `docs/s-atlas/specs/` | 设计记录和它依据的事实。 |

## 开发

```sh
cd packages/dsh-plugin-file
node --test "test/*.test.js"
```

校验索引要用 DSH 自己的校验器，它只能跑在 DSH 的 Electron 运行时里，因为包在 `app.asar` 内：

```sh
ELECTRON_RUN_AS_NODE=1 "<dsh>/DeepSeek Harness.exe" scripts/validate-index.mjs --stamp
```

`--stamp` 把仓库当前 commit 写进每个 git 版本，这是更新能装上的前提。

## 限制

- `agents/*.md` 会解析 `tools` 字段但**不生效**。与其挂一个开关却不起作用，不如先留空。
- 技能和命令改了立即生效；子代理只对新会话生效。
- hooks 需要另装桥接包；本插件只负责定位 `hooks/hooks.json`。
