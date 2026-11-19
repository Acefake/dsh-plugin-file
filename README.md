# dsh-plugin-file

Write a DeepSeek Harness plugin as a directory of Markdown and JSON. No TypeScript, no build step, no bundle tooling.

```markdown
~/.dsh/plugins/hello/
  plugin.json
  skills/greeter/SKILL.md
  commands/summarize-change.md
  agents/reviewer.md
  hooks/hooks.json
```

Drop it in. `hello-greeter` and `/summarize-change` appear in the next session, and `reviewer` shows up as an agent preset.

## Why this exists

DSH plugins are packages: a Cordis entry, a `cordis.patch.yml`, often a Client half, and a build. That is the right shape for code that changes the Host. It is the wrong shape for a prompt, a checklist, or a review routine, which is what most plugins actually are.

Claude Code made this shape famous: a plugin is a folder. This loader gives DSH the same shape without giving up its own registry, so a file plugin is a first-class skill, agent, or hook rather than a parallel system.

## Install

From the plugin index:

```sh
dsh plugin --profile <name> add "git+https://github.com/dsh-plugin-file/dsh-plugin-file.git#<commit>&path:/packages/dsh-plugin-file"
```

Or add `https://raw.githubusercontent.com/dsh-plugin-file/dsh-plugin-file/main/plugins-index.json` as a plugin index and install from **Plugins → Discover**.

## Update

A Git install updates only to a commit the index pins, because the update path replaces the installed copy and must be able to restore it if the new one fails. Point the index at the new commit, then update from Discover.

A branch or tag spec is not updatable by design. `dsh plugin --profile <name> add` again with the new commit, or update through the index.

## Authoring

See [`packages/dsh-plugin-file/docs/DETAIL.md`](packages/dsh-plugin-file/docs/DETAIL.md) for the format, and [`examples/hello-plugin`](examples/hello-plugin) for a worked example.

Two rules worth stating up front:

- **A command is a skill.** `commands/review.md` becomes the `/review` gesture, not a host command. A host command claims its name before the prompt can reach the model, so registering one would break the very thing it is meant to do.
- **A changed agent reaches new sessions only.** An agent preset is activated once and shared by the sessions selecting it. Editing `agents/*.md` does not rewrite a running conversation.

## Layout

| Path | What |
|---|---|
| `packages/dsh-plugin-file/src/parse.js` | Frontmatter and manifest parsing. Pure functions. |
| `packages/dsh-plugin-file/src/discover.js` | Directory scan. Plain `node:fs`. |
| `packages/dsh-plugin-file/src/index.js` | Cordis plugin: provider, presets, watching. |
| `packages/dsh-plugin-file/test/` | `node --test` suites for all three. |
| `plugins-index.json` | The index this repository publishes. |
| `scripts/validate-index.mjs` | Validates the index with DSH's own validator. |
| `docs/s-atlas/specs/` | The design record and the facts it rests on. |

## Development

```sh
cd packages/dsh-plugin-file
node --test "test/*.test.js"
```

Validate the index with the real validator, which only runs under the DSH Electron runtime because it resolves packages from `app.asar`:

```sh
ELECTRON_RUN_AS_NODE=1 "<dsh>/DeepSeek Harness.exe" scripts/validate-index.mjs --stamp
```

`--stamp` writes the repository's current commit into every Git version, which is what makes an update installable.

## Limits

- `agents/*.md` parses a `tools` field but does not yet restrict the tool set. It is kept as metadata rather than wired to a switch that would silently do nothing.
- Hot reload covers skills and commands immediately; agent presets reach new sessions only.
- Hooks require a hooks bridge package; this loader locates `hooks/hooks.json` and leaves its semantics to that bridge.
