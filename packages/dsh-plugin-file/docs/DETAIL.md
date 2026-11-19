# File plugins

Write a plugin as a directory of Markdown and JSON. No TypeScript, no build step.

## What it reads

The loader scans `~/.dsh/plugins/<name>/` and treats any directory carrying a `plugin.json` as a plugin:

```
~/.dsh/plugins/
  hello/
    plugin.json
    skills/
      greeter/
        SKILL.md
    commands/
      review.md
    agents/
      reviewer.md
    hooks/
      hooks.json
```

A `.claude-plugin/plugin.json` is read in the same way, so an existing Claude Code plugin directory works unchanged.

Each of the four directories is optional.

## Skills and commands

`skills/` and `commands/` both produce skills. The difference is only intent, not machinery:

- A skill is available to the model, and to you when it is user-invocable.
- A command is the same thing with a name that reads well as `/review`.

Both appear in the `/` menu and both deliver their body to the model. Neither becomes a registered host command, because a host command claims the name first and cannot carry a prompt.

A skill file starts with frontmatter:

```markdown
---
name: greeter
description: Greets someone by name.
user-invocable: true
---

Say hello and ask how the day is going.
```

| Field | Meaning |
|---|---|
| `name` | Kebab-case identity. Defaults to the file or directory name. |
| `description` | Required. Shown in the catalog and the `/` menu. |
| `whenToUse` | Optional extra guidance for the model. |
| `disable-model-invocation` | `true` hides it from the model; only `/name` reaches it. |
| `user-invocable` | `false` hides it from the `/` menu. |

## Subagents

`agents/*.md` registers one agent preset per file:

```markdown
---
name: reviewer
description: Reviews a change and reports risks.
---

You review software changes. Read the diff, then report risks ordered by
severity. Do not edit files.
```

The body becomes the agent's persona. A `tools` field is parsed and kept as metadata but does not yet restrict the tool set.

**A changed agent reaches new sessions only.** A preset is activated once and shared by the sessions that select it; existing sessions keep the revision they started with.

## Hooks

`hooks/hooks.json` in the Claude Code format is picked up by the hooks bridge. Hooks need the bridge package mounted; the loader itself only locates the file.

## Hot reload

Editing a skill or command file takes effect without a restart. Adding or removing a plugin directory is picked up too.

## Sidebar panel

The bundle adds a **File plugins** entry to the left sidebar. Selecting it opens a panel listing every discovered plugin with the skills, agents, and hooks it contributes, plus the directory being scanned.

The panel reads `/api/plugin-file/inventory`, a read-only route the Host half registers while a web server is mounted. In a headless composition the route is absent and the rest of the plugin still works.

## Marketplace

`plugins-index.json` in the repository root publishes this plugin for the Discover page. Add its raw URL under plugin indexes to browse it from the Web GUI.
