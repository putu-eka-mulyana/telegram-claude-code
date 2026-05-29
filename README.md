# Telegram

Connect a Telegram bot to your Claude Code with an MCP server.

The MCP server logs into Telegram as a bot and provides tools to Claude to reply, react, or edit messages. When you message the bot, the server forwards the message to your Claude Code session.

> **This is a fork** of the official Anthropic `telegram` plugin, adding
> multi-project routing, router failover, an interactive session switcher, and a
> `/telegram:projects` registry skill. It is **not** installed from the official
> marketplace — see **[INSTALL.md](./INSTALL.md)** for fork install steps (local
> clone or GitHub). The marketplace identifier is `telegram-plugin`, so the
> install command is `/plugin install telegram@telegram-plugin`.

## Prerequisites

- [Bun](https://bun.sh) — the MCP server runs on Bun. Install with `curl -fsSL https://bun.sh/install | bash`.

## Quick Setup
> Default pairing flow for a single-user DM bot. See [ACCESS.md](./ACCESS.md) for groups and multi-user setups.

**1. Create a bot with BotFather.**

Open a chat with [@BotFather](https://t.me/BotFather) on Telegram and send `/newbot`. BotFather asks for two things:

- **Name** — the display name shown in chat headers (anything, can contain spaces)
- **Username** — a unique handle ending in `bot` (e.g. `my_assistant_bot`). This becomes your bot's link: `t.me/my_assistant_bot`.

BotFather replies with a token that looks like `123456789:AAHfiqksKZ8...` — that's the whole token, copy it including the leading number and colon.

**2. Install the plugin.**

These are Claude Code commands — run `claude` to start a session first. This
fork ships its own marketplace manifest (`name: telegram-plugin`), so point
Claude Code at the repo and install:

```
# from a local clone:
/plugin marketplace add /path/to/claude_plugins-telegram
# or, after pushing the fork to GitHub:
/plugin marketplace add putu-eka-mulyana/telegram-claude-code

/plugin install telegram@telegram-plugin
/reload-plugins
```

The marketplace identifier (`telegram-plugin`) is the same whether you add it
locally or from GitHub. Full steps and updating: **[INSTALL.md](./INSTALL.md)**.

**3. Give the server the token.**

```
/telegram:configure 123456789:AAHfiqksKZ8...
```

Writes `TELEGRAM_BOT_TOKEN=...` to `~/.claude/channels/telegram/.env`. You can also write that file by hand, or set the variable in your shell environment — shell takes precedence.

> To run multiple bots on one machine (different tokens, separate allowlists), point `TELEGRAM_STATE_DIR` at a different directory per instance.

**4. Relaunch with the channel flag.**

The server won't connect without this — exit your session and start a new one:

```sh
claude --channels plugin:telegram@telegram-plugin
```

**5. Pair.**

With Claude Code running from the previous step, DM your bot on Telegram — it replies with a 6-character pairing code. If the bot doesn't respond, make sure your session is running with `--channels`. In your Claude Code session:

```
/telegram:access pair <code>
```

Your next DM reaches the assistant.

> Unlike Discord, there's no server invite step — Telegram bots accept DMs immediately. Pairing handles the user-ID lookup so you never touch numeric IDs.

**6. Lock it down.**

Pairing is for capturing IDs. Once you're in, switch to `allowlist` so strangers don't get pairing-code replies. Ask Claude to do it, or `/telegram:access policy allowlist` directly.

## Access control

See **[ACCESS.md](./ACCESS.md)** for DM policies, groups, mention detection, delivery config, skill commands, and the `access.json` schema.

Quick reference: IDs are **numeric user IDs** (get yours from [@userinfobot](https://t.me/userinfobot)). Default policy is `pairing`. `ackReaction` only accepts Telegram's fixed emoji whitelist.

**Pause/resume without restarting:** `/telegram:bot off` drops all inbound
messages (the bot goes silent); `/telegram:bot on` restores the previous
policy. It edits `dmPolicy` in `access.json`, which the server re-reads live, so
the toggle takes effect immediately. `/telegram:bot` with no argument reports
on/off status.

## Tools exposed to the assistant

| Tool | Purpose |
| --- | --- |
| `reply` | Send to a chat. Takes `chat_id` + `text`, optionally `reply_to` (message ID) for native threading and `files` (absolute paths) for attachments. Images (`.jpg`/`.png`/`.gif`/`.webp`) send as photos with inline preview; other types send as documents. Max 50MB each. Auto-chunks text; files send as separate messages after the text. Returns the sent message ID(s). |
| `react` | Add an emoji reaction to a message by ID. **Only Telegram's fixed whitelist** is accepted (👍 👎 ❤ 🔥 👀 etc). |
| `edit_message` | Edit a message the bot previously sent. Useful for "working…" → result progress updates. Only works on the bot's own messages. |

Inbound messages trigger a typing indicator automatically — Telegram shows
"botname is typing…" while the assistant works on a response.

## Photos

Inbound photos are downloaded to `~/.claude/channels/telegram/inbox/` and the
local path is included in the `<channel>` notification so the assistant can
`Read` it. Telegram compresses photos — if you need the original file, send it
as a document instead (long-press → Send as File).

## Multi-project routing

One bot can route messages to multiple running Claude Code sessions. All
participating sessions use the same `TELEGRAM_STATE_DIR`; one process owns
Telegram polling and the others act as session connectors.

Register projects with the `/telegram:projects` skill (or hand-edit
`~/.claude/channels/telegram/projects.json`):

```
/telegram:projects add billing /absolute/path/to/billing --label "Billing API"
/telegram:projects                       # list registered projects
/telegram:projects disable billing       # hide without deleting
```

The file it manages:

```json
{
  "projects": {
    "billing": {
      "label": "Billing API",
      "workingDirectory": "/absolute/path/to/billing",
      "enabled": true,
      "launchCommand": ["claude", "--channels", "plugin:telegram@telegram-plugin"],
      "maxManagedSessions": 3
    }
  }
}
```

`maxManagedSessions` (default 3) caps how many sessions the **Start New
Session** button may run at once for a project; manual terminal sessions don't
count. Set it to `0` to disable bot-launched sessions for that project.

Start an initial session and any additional terminal sessions with a registered
project ID:

```sh
TELEGRAM_PROJECT_ID=billing TELEGRAM_SESSION_LABEL=terminal-1 \
  claude --channels plugin:telegram@telegram-plugin
```

Optional variables are `TELEGRAM_SESSION_ID` and
`TELEGRAM_SESSION_ORIGIN=manual|managed`. In Telegram, send `/project_list`,
choose a project (the button shows how many sessions are online), then choose a
live session (labeled with origin and last-active age). The selection is stored
per chat; later messages are delivered only to that selected session. After
selecting, the confirmation offers **Ganti Session**, **Ganti Project**, and
**Status** buttons so you can switch target or check the active binding without
retyping `/project_list`. When a project has a configured `launchCommand`, its
session screen also includes `Start New Session`; press `Refresh Sessions`
after the new connector starts. Session IDs are scoped to their project, so two
projects may both expose a session named `terminal-1`.

If you switch a chat to a different session while an earlier one is still
working, the late reply from that earlier session is prefixed with its origin
(`[Project / session]`) so parallel answers stay attributable; the
currently-bound session replies without a prefix.

Only the router process polls the shared bot token. If the router session
exits, the next heartbeat promotes a surviving connector to router
automatically — the bot keeps responding as long as at least one session is
alive. Do not run the same token with different state directories for this
mode; Telegram permits one `getUpdates` consumer per token.

## No history or search

Telegram's Bot API exposes **neither** message history nor search. The bot
only sees messages as they arrive — no `fetch_messages` tool exists. If the
assistant needs earlier context, it will ask you to paste or summarize.

This also means there's no `download_attachment` tool for historical messages
— photos are downloaded eagerly on arrival since there's no way to fetch them
later.
