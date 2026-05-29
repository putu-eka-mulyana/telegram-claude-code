# Installing this fork

This is a **fork** of the official Anthropic `telegram` channel plugin, with
multi-project routing, router failover, an interactive session switcher, and a
`/telegram:projects` registry skill added. Because it is a fork, you don't
install it from the official marketplace — you point Claude Code at *this*
repository (which ships its own `.claude-plugin/marketplace.json`).

The marketplace identifier is the `name` field in
`.claude-plugin/marketplace.json` → **`telegram-plugin`**. That name is the same
whether you add the marketplace from a local folder or from GitHub, so the
install command never changes:

```
/plugin install telegram@telegram-plugin
```

## Prerequisites

- [Bun](https://bun.sh) — the MCP server runs on Bun:
  `curl -fsSL https://bun.sh/install | bash`
- A Telegram bot token from [@BotFather](https://t.me/BotFather).

---

## Option A — Install from a local clone (works today, no GitHub needed)

Use this when the repo lives on the same machine as Claude Code.

```
/plugin marketplace add /Volumes/MacSpace/LEARN/fullstack/claude_plugins-telegram
/plugin install telegram@telegram-plugin
/reload-plugins
```

> Replace the path with wherever this repo lives on your machine. A relative
> path from your current directory (e.g. `./claude_plugins-telegram`) also
> works.

## Option B — Install from GitHub (after you push the fork)

Push this repository to GitHub first, then anyone can install it:

```
/plugin marketplace add putu-eka-mulyana/telegram-claude-code
/plugin install telegram@telegram-plugin
/reload-plugins
```

Replace `putu-eka-mulyana/telegram-claude-code` with your fork, e.g. `tenzro/claude_plugins-telegram`.
Full git URLs work too: `/plugin marketplace add https://github.com/putu-eka-mulyana/telegram-claude-code.git`.

> `source: "./"` in `marketplace.json` resolves against the repo root, so the
> GitHub path requires that `marketplace.json` and `plugin.json` stay in
> `.claude-plugin/` at the repo root (they do).

---

## After installing

**1. Save the bot token:**

```
/telegram:configure 123456789:AAH...
```

**2. Relaunch Claude Code with the channel enabled** — the identifier uses the
same marketplace name:

```sh
claude --channels plugin:telegram@telegram-plugin
```

**3. Pair and lock down:** DM your bot → it replies with a 6-char code →
`/telegram:access pair <code>` → then `/telegram:access policy allowlist`.

See [README.md](./README.md) for the full setup walkthrough,
[ACCESS.md](./ACCESS.md) for access control, and
[PANDUAN_PENGGUNAAN_DAN_DESAIN_MULTI_PROJECT.md](./PANDUAN_PENGGUNAAN_DAN_DESAIN_MULTI_PROJECT.md)
for the multi-project router (Indonesian).

---

## Updating after the fork changes

Edits to a **locally-added** marketplace are picked up on
`/reload-plugins` (or restart). For a GitHub-added marketplace, refresh first:

```
/plugin marketplace update telegram-plugin
/plugin install telegram@telegram-plugin     # reinstall to pull the new version
```

Bump `version` in both `.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` when you publish a change so the update is
visible.

---

## For maintainers — how this repo is its own marketplace

A Claude Code marketplace is any git repo (or folder) containing
`.claude-plugin/marketplace.json`. This fork doubles as a single-plugin
marketplace:

- `.claude-plugin/marketplace.json` — `name: "telegram-plugin"`, one entry in
  `plugins[]` with `source: "./"` (the plugin is the repo root).
- `.claude-plugin/plugin.json` — the plugin manifest; its `name` (`telegram`)
  must match the `plugins[].name` in the marketplace file.

The marketplace `name` is the **public identifier** users type after `@`. Keep
it stable — changing it breaks everyone's existing `/plugin install` and
`--channels` commands.
