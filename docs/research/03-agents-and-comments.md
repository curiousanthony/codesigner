# 03 — Coding agents (Claude Code / Codex / Cursor) and DOM-aware Comments

Status: research, decision-grade. Date: 2026-10-18. Author: research pass for "codesigner" (placeholder name), an Electron + SvelteKit visual canvas that edits a real local SvelteKit app.

Scope:
1. Driving Claude Code, OpenAI Codex and Cursor from a desktop app using the user's **own** logins (no bundled keys, no backend).
2. Passing canvas context (selection, screenshot, comments) to agents through an app-hosted MCP server.
3. Git/worktree workflow when an agent and a human (via the canvas) edit the same tree at the same time.
4. A Comments data model that survives code edits and that agents can read and resolve.

Confidence labels used below: **[verified]** means checked against primary docs, a package tarball or the npm registry on 2026-10-18. **[secondary]** means from third-party write-ups. **[unverified]** means plausible but not confirmed. Treat unverified items as things to test before relying on them.

---

## 0. TL;DR

- **Build on ACP (Agent Client Protocol) first.** Use `@agentclientprotocol/sdk` as the client library. All three target agents speak ACP today:
  - Claude, through `@agentclientprotocol/claude-agent-acp`, which wraps the Claude Agent SDK.
  - Codex, through `@agentclientprotocol/codex-acp`, which wraps `codex app-server`.
  - Cursor, natively, through `agent acp`.

  ACP gives one wire protocol for streaming text, tool calls with diffs, permission requests, modes, session load/resume, image prompts, and per-session MCP server injection. That injection means no writes to the user's global config.
- **Claude compliance posture:**
  - Spawn the user's own, unmodified, installed `claude` binary (`CLAUDE_CODE_EXECUTABLE=<path>`).
  - Don't ship the Agent SDK's bundled native binary.
  - Never touch Claude tokens or the Keychain.
  - Let the user sign in through Anthropic's own flow (`claude auth login`).

  Anthropic's legal page explicitly carves out "an end user ... signing in to the unmodified Claude Code binary with their own Claude subscription". It forbids apps that "offer Claude.ai login" or "collect, store, or intermediate" Claude credentials. The carve-out cross-references the "offer Claude Code in your products" section, which requires Commercial Terms. Whether a local open-source app that spawns the user's own binary falls under that section is unresolved (§1.1.1, §6).
- **Codex:** ChatGPT login is first-class in `codex app-server` (`account/login/start {type:"chatgpt"}`), and OpenAI is openly permissive about third-party harnesses. Lowest policy risk of the three.
- **Cursor:** use `agent acp` (native). Auth is `agent login` (the user's Cursor account) or `CURSOR_API_KEY`. MCP-via-`session/new` was broken for months and reportedly fixed 2026-10-04. Verify it at startup and keep a fallback.
- **Expose one local MCP server from the app:**
  - Transport: streamable HTTP on `127.0.0.1:<random>`, with a per-session bearer token. Reject requests that carry an `Origin` header.
  - Tools: `get_selection`, `get_canvas_screenshot`, `list_comments`, `resolve_comment`, `get_routes`, `get_design_tokens`, `get_dev_server_errors`, and more.
  - Registration: inject it per session through ACP `session/new.mcpServers`. Fall back to per-invocation CLI flags (`claude --mcp-config '<json>'`, `codex -c ...`).
- **Git:**
  - Run the agent in the **same worktree the canvas previews**, so changes appear live.
  - Snapshot pre- and post-turn into **app-owned private refs** (`refs/codesigner/...`, the Conductor pattern). This leaves the user's index and branch untouched.
  - Undo a turn by reverse-applying `pre..post` with a 3-way merge.
  - Serialize canvas writes against agent turns through a write coordinator.
  - Don't rely on agent-native checkpoints. Claude's miss Bash and subagent edits, and Cursor's are flaky and absent in the CLI.
- **Comments:**
  - Store one JSON file per comment in `.codesigner/comments/<ulid>.json`, committed to git.
  - Anchor each comment with several signals: source location (file:line:col + component + blob SHA), stable DOM signals (test id, selector, role/name, text snippet), route + params, viewport, and a screenshot crop.
  - Re-anchor by priority, with an "outdated" state when anchoring fails.
  - Agents read and resolve comments through MCP tools. "Implement all unresolved" runs one comment per agent turn by default, for granular undo.

---

## 1. Driving each agent with the user's existing login

### 1.1 Claude Code

#### 1.1.1 Policy: what's allowed in October 2026

Primary sources, all fetched 2026-10-18:

1. **Claude Code "Legal and compliance"** ([code.claude.com/docs/en/legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)), section "Authentication and credential use":
   - OAuth "is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
   - Developers building products, "including those using the Agent SDK, should use API key authentication".
   - "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users."
   - Developers "may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
   - **Carve-out:** this "does not ... prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code".
   - "Can customers offer Claude Code in their products?" Preinstalling or running Claude Code in your product requires the Commercial Terms. The binary "must not be modified", you may not "remove, disable, or restrict any authentication method built into it", and "Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential".
   - Naming: you may say your product "runs Claude Code". You may not use "Claude Code" or Anthropic in your product name or logo.
2. **Agent SDK overview** ([code.claude.com/docs/en/agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview)): "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." Branding: say "Claude Agent", not "Claude Code".
3. **Support article "Use the Claude Agent SDK with your Claude plan"** ([support.claude.com/.../15036540](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)):
   - The June 15, 2026 split into a separate "Agent SDK credit" was **paused**.
   - The Oct 7, 2026 update says Max and Team plans now include monthly API credits covering the Agent SDK, `claude -p`, the API and Managed Agents.
   - It also says: "You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits."
4. History, from secondary sources:
   - Jan 9, 2026: server-side blocks on third-party OAuth use (OpenCode/OpenClaw-style harnesses that replayed Claude Code's OAuth client).
   - Feb 19, 2026: docs clarification, later partly walked back as "confusing".
   - Apr 4, 2026: Boris Cherny (Head of Claude Code) said subscriptions stop covering usage through third-party tools, with OpenClaw targeted first.

   Coverage: [GIGAZINE](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block/), [WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/), [Natural 20](https://natural20.com/coverage/anthropic-banned-openclaw-oauth-claude-code-third-party). Those enforcement actions targeted apps that **extracted or replayed OAuth tokens or impersonated the Claude Code client**, not apps that spawn the official binary.

**How to read this (not legal advice):**

| Pattern | Risk | Notes |
|---|---|---|
| App extracts the token from Keychain or `~/.claude/.credentials.json`, or calls the Anthropic API with it | **Prohibited** | "collect, store, or intermediate". This is exactly what was blocked in 2026. |
| App ships its own OAuth "Sign in with Claude" (own client id or a copied one) | **Prohibited** | "offer Claude.ai login into their own applications". |
| App asks the user to run `claude setup-token` and paste it | **Prohibited in spirit** | The app would be storing a subscription token. `setup-token` is meant for the user's own CI. |
| App spawns the **user-installed, unmodified `claude` binary**. The user logged in themselves with `claude auth login` in their terminal. The app never sees credentials. | **Allowed by the carve-out** (best available posture) | This is what Conductor, Nimbalyst, Zed's Claude Agent and Superset do. Usage counts against the user's plan. |
| Same, but the app shows a button that launches `claude auth login --claudeai` in an embedded terminal (ACP "terminal-auth") | **Grey** | The sign-in still completes through Anthropic's own flow in the official binary, but the UI could read as "offering Claude.ai login". Prefer instructions plus a "copy command" button, or open the user's own Terminal. |
| App bundles the Agent SDK's native `claude` binary inside the .app | **Grey / Commercial-Terms territory** | Arguably "preinstalling Claude Code in your product". Avoid it: resolve the user's binary instead. |

The adapter maintainers anticipate this split. `claude-agent-acp` has a `--hide-claude-auth` flag that makes the adapter refuse subscription auth with "This integration does not support using claude.ai subscriptions." **[verified in the 0.93.0 tarball]**

**Product guardrails to implement:**
- Detect `claude` on the user's login-shell PATH. Electron GUI apps on macOS don't inherit the shell PATH, so run `$SHELL -ilc 'command -v claude'` or use the `shell-env` package.
- Check `claude auth status`. It prints JSON whose `authMethod` is one of `none | claude.ai | oauth_token | api_key | api_key_helper | third_party`, and exits 0 if logged in **[verified, CLI reference]**. When logged out, show "Run `claude auth login` in your terminal" with a copy button.
- Show which billing applies ("Your Claude plan via Claude Code CLI" or "API key"). Link `/status`.
- **Strip `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the child env** unless the user explicitly opts into API billing. In `-p` mode an API key always wins over the subscription, silently, per [authentication precedence](https://code.claude.com/docs/en/authentication).
- Brand the tab "Claude" or "Claude Agent", never "Claude Code".
- Keep an API-key and Bedrock/Vertex path as a fallback if policy tightens.

#### 1.1.2 Raw CLI: `claude -p` with stream-json

```bash
claude -p \
  --input-format stream-json --output-format stream-json --verbose \
  --include-partial-messages --replay-user-messages \
  --session-id 6f1c2a3e-0000-4000-8000-000000000000 \
  --permission-mode acceptEdits \
  --allowedTools "mcp__codesigner" "Read" "Edit" "Write" "Bash(npm run check *)" \
  --mcp-config '{"mcpServers":{"codesigner":{"type":"http","url":"http://127.0.0.1:51234/mcp","headers":{"Authorization":"Bearer <session-token>"}}}}' \
  --append-system-prompt-file /path/to/codesigner-system.md \
  --permission-prompt-tool mcp__codesigner__approve_tool
```

Use `--session-id <uuid>` on the first turn only. For later processes, pass `--resume <id>` instead (or keep one long-lived process with `--input-format stream-json`).

Relevant flags, all **[verified, cli-reference]**:

| Flag | Purpose |
|---|---|
| `--input-format stream-json` | Long-lived process: you write user messages to stdin as NDJSON. Enables multi-turn and interrupt. |
| `--output-format stream-json --verbose` | NDJSON events: `system/init`, `assistant`, `user` (tool results), `stream_event` (with `--include-partial-messages`), `system/api_retry`, `permission_denied`, `result`. |
| `--session-id <uuid>` / `--resume <id>` / `--fork-session` / `--continue` | Session identity and resume. `--resume` also accepts a `.jsonl` transcript path. |
| `--permission-mode` | `default`/`manual`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`. If omitted, a run may start in `auto`, so always pass one. |
| `--allowedTools` / `--disallowedTools` / `--tools` | Permission rule syntax: `Bash(git diff *)`, `mcp__server`, `mcp__server__tool`. |
| `--permission-prompt-tool <mcp tool>` | Routes "would prompt" decisions to an MCP tool. **The app's own MCP server can serve the approval UI.** |
| `--permission-prompts none` | For unattended runs (v2.1.259+). |
| `--mcp-config <file-or-json>` / `--strict-mcp-config` | Per-invocation MCP servers. `--strict-mcp-config` ignores all other MCP config. With `-p`, the run waits up to `MCP_TIMEOUT` (30 s) for servers. |
| `--settings <file-or-json>` | Per-invocation settings overlay. Hooks can be injected here without editing the user's files. |
| `--setting-sources user,project,local` | Choose which settings files load. |
| `--append-system-prompt[-file]` | Add codesigner instructions while keeping Claude Code's default prompt. |
| `--max-turns`, `--max-budget-usd`, `--model`, `--effort`, `--add-dir` | Usual controls. |

Example stdin message (one line per message), with an image:

```json
{"type":"user","message":{"role":"user","content":[
  {"type":"text","text":"Make the selected card's CTA match the primary button style."},
  {"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBORw0..."}}
]}}
```

Example stdout events (illustrative and abridged; the event types are documented, but field values and shapes here are reconstructed):

```json
{"type":"system","subtype":"init","session_id":"6f1c...","model":"claude-...","tools":["Read","Edit","..."],"mcp_servers":[{"name":"codesigner","status":"connected"}],"capabilities":["interrupt_receipt_v1"]}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Looking at "}},"session_id":"6f1c..."}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_01","name":"Edit","input":{"file_path":"/abs/src/lib/Card.svelte","old_string":"...","new_string":"..."}}]},"parent_tool_use_id":null}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_01","content":"..."}]}}
{"type":"result","subtype":"success","session_id":"6f1c...","total_cost_usd":0.0,"num_turns":4,"result":"Updated the CTA...","permission_denials":[]}
```

**Permission prompt tool contract [secondary; long-standing SDK docs pattern, verify on your pinned version].**
- The MCP tool receives `{ tool_name, input, tool_use_id }`.
- It returns a text content block holding JSON: `{"behavior":"allow","updatedInput":{...}}` or `{"behavior":"deny","message":"why"}`.
- The Agent SDK's `canUseTool` uses an internal stdin/stdout `control_request` protocol instead. That protocol is not a documented public contract for raw CLI users.

**Raw-CLI caveats, important:**
- **`--bare` breaks subscription auth.** "In bare mode, Claude Code never reads OAuth credentials or the system keychain." The headless docs say `--bare` "will become the default for `-p` in a future release" **[verified]**.
  - A raw `claude -p` integration could silently lose subscription auth on a CLI update.
  - Mitigations: pin and test CLI versions, feature-detect via `system/init.capabilities`, and watch the changelog.
  - Whether Agent SDK spawns are affected the same way is **[unverified]**. The SDK passes its own flags, so check the SDK changelog when that default flips.
- **Untrusted repos:** without `--bare`, a `-p` session "runs the hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a folder you've never trusted", with no trust dialog **[verified]**. codesigner must show its own **workspace-trust** prompt before the first agent run in a repo. Optionally pass `--setting-sources user` and `--strict-mcp-config` for untrusted repos.
- SIGTERM leaves the turn unfinished (exit 143). Use SIGINT, or SDK `interrupt()`, to end a turn cleanly.
- Hooks fit well here: `PreToolUse` and `PostToolUse` let you take file snapshots around Edit/Write, and `Stop` lets you finalize the post-turn checkpoint. Inject them via `--settings '{"hooks":{...}}'` so nothing is written to the user's settings.

#### 1.1.3 Claude Agent SDK (TypeScript)

- Package: `@anthropic-ai/claude-agent-sdk`, latest **0.3.302** (2026-10-16) **[verified npm]**.
- It is "a library that runs the Claude Code binary". The npm package **bundles a native Claude Code binary as an optional dependency** (`@anthropic-ai/claude-agent-sdk-darwin-arm64`, ...). Use `pathToClaudeCodeExecutable` to point at another binary **[verified]**.
- **Can it use the subscription?** Technically yes. It spawns the CLI, which reads the user's login, and it does so unless `ANTHROPIC_API_KEY` is set. Policy-wise, the docs tell product developers to use API keys "unless previously approved". The compliant reading is the carve-out above: the user's own unmodified `claude` binary, signed in by the user.
  - So, if you use the SDK: `pathToClaudeCodeExecutable: <user's claude>`, exclude the optional native packages from the Electron bundle (`npm i --omit=optional`, or electron-builder `files` excludes), and pass `env` without API keys.
- Useful options **[verified, TS reference]**:
  - `canUseTool`: permission callback.
  - `permissionMode`: `default | acceptEdits | bypassPermissions | plan | dontAsk | auto`.
  - `mcpServers`: types `stdio | sse | http | sdk`. `sdk` runs **in-process**, created via `createSdkMcpServer()`.
  - Session controls: `resume`, `sessionId`, `forkSession`.
  - `includePartialMessages`.
  - `settingSources` (`[]` = ignore filesystem settings).
  - `strictMcpConfig`.
  - `enableFileCheckpointing` together with `query.rewindFiles(userMessageId, {dryRun})`.
  - `systemPrompt: {type:'preset', preset:'claude_code', append}`.
  - `env`, which **replaces** `process.env`, so spread it yourself.
  - `hooks`.
  - Query methods: `interrupt()`, `setPermissionMode()`, `setModel()`, `streamInput()`, `close()`, `accountInfo()`, `mcpServerStatus()`, `getContextUsage()`.
- The in-process `sdk` MCP server type is attractive: no port and no token. It ties you to the SDK path, though, and not to ACP.

### 1.2 OpenAI Codex CLI

Package `@openai/codex` **0.163.0** (2026-10-15), plus a TS wrapper `@openai/codex-sdk` 0.163.0 that drives `codex exec` **[verified npm]**. Apache-2.0. Docs moved to `learn.chatgpt.com/docs/...`.

**Auth.**
- `codex login` uses ChatGPT sign-in (browser or device code) and stores `~/.codex/auth.json` (`$CODEX_HOME`). API keys come via `CODEX_API_KEY` / `OPENAI_API_KEY`.
- `codex exec` "reuses saved CLI authentication" **[verified]**.
- In `app-server`, login is a protocol call **[verified, learn.chatgpt.com/docs/app-server]**:
  - `account/login/start {type:"chatgpt"}` returns `{loginId, authUrl}`. Completion arrives as `account/login/completed` and then `account/updated`.
  - Also `{type:"chatgptDeviceCode"}`, `{type:"apiKey", apiKey}`, and experimental `{type:"chatgptAuthTokens", ...}`.
  - `account/read` returns `{type:"chatgpt", email, planType}`.
  - `account/rateLimits/read` and the notification `account/rateLimits/updated` let you show plan usage in the UI.
- Do **not** set `CODEX_HOME` to isolate config. That also isolates `auth.json` and would log the user out.

**Policy.**
- OpenAI is openly permissive. A "Sign in with ChatGPT" program for third-party tools launched in Sep 2026 with 16 partners [secondary: [The New Stack](https://thenewstack.io/sign-in-with-chatgpt/)]. OpenAI staff have publicly encouraged using Codex and a subscription "wherever you like" [secondary].
- Spawning the user's own `codex` with their own login is the same pattern Zed uses through codex-acp.
- Set `initialize.clientInfo.name = "codesigner"`. The docs say it is used "for compliance logs".

**`codex exec --json` (one-shot, JSONL)** **[verified, learn.chatgpt.com/docs/non-interactive-mode]**:

```bash
codex exec --json --sandbox workspace-write \
  -c 'mcp_servers.codesigner.url="http://127.0.0.1:51234/mcp"' \
  -c 'mcp_servers.codesigner.bearer_token_env_var="CODESIGNER_MCP_TOKEN"' \
  "Make the selected card's CTA match the primary button"
codex exec resume <SESSION_ID> --json "follow-up"
```

Illustrative, abridged. Only the `thread.started` line is verbatim from the docs; the rest follows the documented event and item types.

```json
{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_3","type":"file_change","changes":[{"path":"src/lib/Card.svelte","kind":"update"}],"status":"completed"}}
{"type":"item.completed","item":{"id":"item_4","type":"agent_message","text":"Done."}}
{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122}}
```

Exec flags:
- `--sandbox read-only | workspace-write | danger-full-access` (default read-only).
- `--full-auto` is **no longer supported**. Use `--sandbox workspace-write` or `--approve-for-me`.
- `--ephemeral`, `--skip-git-repo-check`, `--ignore-user-config`, `--ignore-rules`, `-o/--output-last-message`, `--output-schema`.
- Exec has no interactive approvals, so it is unsuitable for an approval UI.
- Approval policy (`-a/--ask-for-approval` or `approval_policy` in config) takes `untrusted | on-request | never`; `on-failure` is deprecated **[unverified against 0.163]**.
- `-c` takes dotted-key TOML values and is documented generally. Using `-c mcp_servers.<name>.*` specifically is **[unverified]** but follows the rules. `-i <image>` for exec is **[unverified]**.

**`codex app-server` (recommended direct path; what the IDE extensions use)** **[verified]**:
- Transport: stdio JSONL by default (`--listen stdio://`). WebSocket and unix-socket transports are experimental. JSON-RPC 2.0 **without** the `"jsonrpc"` field.
- Primitives: Thread, Turn, Item.
- Methods:
  - Thread: `thread/start | resume | fork | read | list | revert | compact/start`.
  - Turn: `turn/start` (input: text, image, `localImage`, skill; per-turn `cwd`, sandbox policy, model, effort, `outputSchema`), `turn/steer`, `turn/interrupt`.
  - Other: `review/start`, `model/list`, `config/read | value/write`, `mcpServerStatus/list`, `config/mcpServer/reload`, `fs/*`.
- Notifications:
  - `thread/started`, `turn/started`, `turn/completed`.
  - `item/started`, `item/completed`, `item/agentMessage/delta`.
  - `turn/diff/updated` carries `{threadId, turnId, diff}`, the **aggregated unified diff of the turn**, which is ideal for a "changes" panel.
  - `turn/plan/updated`, `mcpServer/startupStatus/updated`.
- Server→client approval requests:
  - `item/commandExecution/requestApproval`: decisions `accept | acceptForSession | decline | cancel | {acceptWithExecpolicyAmendment}`.
  - `item/fileChange/requestApproval`: decisions `accept | acceptForSession | decline | cancel`.
  - Also `item/permissions/requestApproval`, `mcpServer/elicitation/request`, `tool/requestUserInput`.
- Typed schemas: `codex app-server generate-ts` or `generate-json-schema`. These are version-specific, so generate them at build time against a pinned Codex.

```json
{"method":"initialize","id":0,"params":{"clientInfo":{"name":"codesigner","title":"codesigner","version":"0.1.0"}}}
{"method":"initialized"}
{"method":"thread/start","id":1,"params":{"cwd":"/Users/me/site","approvalPolicy":"on-request","sandbox":"workspace-write"}}
{"method":"turn/start","id":2,"params":{"threadId":"thr_123","input":[{"type":"text","text":"..."},{"type":"localImage","path":"/tmp/sel.png"}]}}
{"method":"turn/interrupt","id":3,"params":{"threadId":"thr_123","turnId":"turn_456"}}
```

The exact param names for `thread/start` (`approvalPolicy` / `sandbox` / `config`) come from the protocol summary. Confirm them against `generate-ts`. Passing `mcp_servers` through `thread/start.config` is **[unverified]**.

**`codex mcp-server`** runs Codex *as* an MCP server exposing `codex` / `codex-reply` tools. It's useful for agent-to-agent use, but its events are too coarse for a chat UI. Not recommended here.

**Codex MCP config** **[verified, learn.chatgpt.com/docs/extend/mcp]**:
- Location: `[mcp_servers.<name>]` in `~/.codex/config.toml`, or project `.codex/config.toml` (trusted projects only).
- stdio keys: `command`, `args`, `env`, `cwd`, `env_vars`.
- HTTP keys: `url`, `bearer_token_env_var`, `http_headers`.
- Other keys: `startup_timeout_sec`, `tool_timeout_sec`, `enabled`, `required`, `enabled_tools`, `disabled_tools`, `default_tools_approval_mode` (`auto | prompt | writes | approve`), and per-tool `tools.<tool>.approval_mode`.
- Set codesigner's tools to `auto` so read tools don't prompt.

### 1.3 Cursor CLI

- The binary is now **`agent`** (older docs and integrations say `cursor-agent`). Install: `curl https://cursor.com/install -fsS | bash`.
- Auth: `agent login` (the user's Cursor account and subscription), `--api-key` / `CURSOR_API_KEY`, or `--auth-token` / `CURSOR_AUTH_TOKEN` **[verified, cursor.com/docs/cli/acp]**.

**Headless** **[verified, cursor.com/docs/cli/headless]**:

```bash
agent -p --force --output-format stream-json --stream-partial-output "Refactor ..."
agent -p --output-format json "Analyze ..." | jq -r '.result'
```

- Without `--force` (alias `--yolo`), print mode only *proposes* changes.
- `stream-json` events carry `type`, `subtype`, `timestamp_ms`, `model_call_id`. **No official event schema is published [unverified shape].**
- `--resume`, `--model`, `agent ls` exist but weren't documented on that page.

**ACP (native, recommended)** **[verified, cursor.com/docs/cli/acp]**:
- `agent acp` speaks stdio JSON-RPC.
- Auth method id `cursor_login`.
- Methods: `session/new`, `session/load`, `session/prompt`, `session/update`, `session/request_permission` (options `allow-once | allow-always | reject-once`), `session/cancel`.
- Modes: `agent | plan | ask`.
- Extensions: `cursor/ask_question` and `cursor/create_plan` are blocking. `cursor/update_todos`, `cursor/task` and `cursor/generate_image` are notifications.
- "If your client does not answer permission requests, tool execution can block."

**Cursor limitations:**
- MCP config lives in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json`. Team MCP servers from the dashboard are **not** available in ACP mode.
- **MCP servers passed via ACP `session/new` were silently dropped.** Reported 2026-03-06 against CLI 2026.02.27. Cursor staff said on **2026-10-04** that the approval middleware was removed from that path. The reporter hasn't confirmed ([forum](https://forum.cursor.com/t/mcp-servers-passed-via-session-new-dont-work-in-acp-mode/153823)).
  - Old workaround: pre-seed `~/.cursor/projects/<slug>/mcp-approvals.json`.
- `--approve-mcps` only affects the interactive CLI, not ACP.
- A project-level `.cursor/mcp.json` was not detected in build 2026.03.30 (acknowledged bug).
- `session/list` is not supported in ACP (forum, 2026.03.30). Keep your own session index.
- No checkpoint/restore in the CLI.
- Policy: Cursor documents `agent acp` explicitly "for custom clients", so a third-party client is an intended use. No explicit terms page on using a personal subscription through third-party GUIs was found **[unverified]**.

### 1.4 Agent Client Protocol (ACP)

**Status.**
- Created by Zed (Aug 2025). The ACP Registry was co-launched with JetBrains in Jan 2026.
- Clients: Zed, JetBrains (incl. "AIR"), Neovim/Emacs plugins, Microsoft's Intelligent Terminal, Devin Desktop, OpenHands, and more. The [agents page](https://agentclientprotocol.com/get-started/agents) lists Claude Agent, Codex CLI, Gemini CLI, Cursor, GitHub Copilot (preview), OpenCode, Goose, Cline, Kiro, Qwen Code, Junie and others.
- Protocol version 1 (`protocolVersion: 1`).

**Current packages** **[verified npm, 2026-10-18]**:

| Agent | ACP route | Package / command | Notes |
|---|---|---|---|
| Claude | Adapter over Claude Agent SDK | `@agentclientprotocol/claude-agent-acp` **0.93.0** (2026-10-16), depends on `@anthropic-ai/claude-agent-sdk` 0.3.300 and `@agentclientprotocol/sdk` 1.9.0 | Set `CLAUDE_CODE_EXECUTABLE` to the user's `claude`. The adapter checks this env var before the bundled binary (verified in source). The old `@zed-industries/claude-code-acp` (0.16.2, Feb 2026) and `@zed-industries/claude-agent-acp` (0.23.1, Mar 2026) are **stale**. |
| Codex | Adapter over `codex app-server` | `@agentclientprotocol/codex-acp` **2.2.2** (2026-10-10) | Bundles `@openai/codex`. `CODEX_PATH` selects another binary. `CODEX_CONFIG` (JSON) is merged into session config. `INITIAL_AGENT_MODE` (`read-only | workspace-write | agent | agent-full-access`). Auth methods: ChatGPT login, API key. A native `codex --acp` flag is mentioned only by a blog **[unverified]**. |
| Cursor | Native | `agent acp` | See §1.3 caveats. |
| Gemini CLI | Native | `gemini --experimental-acp` (historical flag; verify) | Optional extra. |

**What `claude-agent-acp` 0.93.0 advertises** (read from the tarball's `initialize` handler):
- `loadSession: true`.
- `sessionCapabilities: {list, resume, fork, close, delete, additionalDirectories, systemPrompt}`.
- `promptCapabilities: {image: true, embeddedContext: true}`.
- `mcpCapabilities: {http: true, sse: true}`.
- `auth.logout`, prompt queueing, and a `_session/steering` extension.
- Auth methods are **terminal-auth**:
  - "Claude Subscription" runs `claude auth login --claudeai`.
  - "Anthropic Console" runs `... --console`.
  - Both appear only if the client declares `clientCapabilities.auth.terminal` (or `_meta["terminal-auth"]`). `--hide-claude-auth` removes the subscription option.
- If codesigner doesn't declare terminal auth, the adapter offers no in-app login. It then relies on an existing CLI login, which is the cleanest compliance posture.

**Wire examples** **[verified, agentclientprotocol.com]**:

```json
{"jsonrpc":"2.0","id":1,"method":"session/new","params":{
  "cwd":"/Users/me/site",
  "mcpServers":[{"type":"http","name":"codesigner","url":"http://127.0.0.1:51234/mcp",
                 "headers":[{"name":"Authorization","value":"Bearer <session-token>"}]}]}}
{"jsonrpc":"2.0","id":2,"method":"session/prompt","params":{"sessionId":"sess_1","prompt":[
  {"type":"text","text":"Make the selected card's CTA match the primary button."},
  {"type":"image","mimeType":"image/png","data":"iVBORw0..."},
  {"type":"resource_link","uri":"file:///Users/me/site/src/lib/Card.svelte","name":"Card.svelte"}]}}
```

Agent → client stream (abridged). Tool calls carry `kind` (`read | edit | delete | move | search | execute | think | fetch | switch_mode | other`), `status` (`pending | in_progress | completed | failed`), `locations: [{path, line}]`, and `content`, which can include `{type:"diff", path, oldText, newText}`:

```json
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Updating "}}}}
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_1","update":{"sessionUpdate":"tool_call","toolCallId":"t1","title":"Edit Card.svelte","kind":"edit","status":"pending","locations":[{"path":"/Users/me/site/src/lib/Card.svelte","line":42}]}}}
{"jsonrpc":"2.0","id":7,"method":"session/request_permission","params":{"sessionId":"sess_1","toolCall":{"toolCallId":"t1"},"options":[
  {"optionId":"a1","name":"Allow once","kind":"allow_once"},{"optionId":"a2","name":"Always","kind":"allow_always"},{"optionId":"r1","name":"Reject","kind":"reject_once"}]}}
{"jsonrpc":"2.0","id":7,"result":{"outcome":{"outcome":"selected","optionId":"a1"}}}
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_1","update":{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed","content":[{"type":"diff","path":"/Users/me/site/src/lib/Card.svelte","oldText":"...","newText":"..."}]}}}
```

Other client-side capabilities:
- `fs/read_text_file` and `fs/write_text_file`, if the client advertises `fs`. This is interesting: the agent's writes then go **through codesigner**, which can coordinate them with canvas edits. Not every adapter routes edits through it, so don't depend on it.
- `terminal/*`, `elicitation/create`.
- Other agent methods: `session/load`, `session/resume`, `session/set_mode`, `session/cancel`, `authenticate`, `logout`.

**TS client library:** `@agentclientprotocol/sdk` **1.9.0**. Use the fluent `client()` API. `ClientSideConnection` and `AgentSideConnection` are **deprecated** **[verified, libraries/typescript page]**.

**Does ACP give a single unified integration?** Mostly yes:

| Need | ACP coverage |
|---|---|
| Streaming text/thoughts | `agent_message_chunk`, `agent_thought_chunk` |
| Tool calls, file locations, diffs | `tool_call` / `tool_call_update` with `locations` and `diff` content |
| Permission requests | `session/request_permission` (uniform) |
| Modes (plan/ask/accept edits) | `session/set_mode` + `current_mode_update` |
| Session persistence | `session/load` / `resume` (Claude yes; Codex adapter yes for resume; Cursor load yes, list no) |
| Images in prompts | `promptCapabilities.image` (Claude yes, Codex yes, Cursor: verify) |
| Per-session MCP injection | `session/new.mcpServers` (Claude http/sse yes, Codex stdio/http yes, Cursor fixed per staff in Oct 2026, verify) |
| Turn-level aggregate diff | Not standardized. Compute it yourself from git (§3), or use adapter extensions (AIR diff extension). |
| Plan usage / rate limits | Not standardized (Codex app-server has it natively; Claude has `/status`). |
| Checkpoint/rewind | Not standardized. Own it in git (§3). |

**ACP-first vs per-CLI adapters, recommendation: ACP-first.**
- **Pros:**
  - One client implementation covers three agents, plus every future registry agent.
  - Adapters are maintained by the ACP org and battle-tested in Zed and JetBrains.
  - MCP injection per session.
  - Uniform permission UI.
  - Electron already ships Node, so users don't need Node installed. Run adapters with `utilityProcess.fork()` (Electron-native, stdio pipes), or with `process.execPath` + `ELECTRON_RUN_AS_NODE=1`. The second option fails if the production build disables the RunAsNode fuse (`@electron/fuses`), as Electron's security guidance recommends **[verify]**.
- **Cons:**
  - Lowest-common-denominator features.
  - Extra process and dependency per agent.
  - Version skew between adapter, SDK and CLI.
  - Extension churn (`_meta`, AIR).
  - Cursor's ACP is the least mature.
- **Mitigation:** an `AgentDriver` interface in codesigner with an `AcpDriver` implementation. For specific features, keep the option of a `CodexAppServerDriver` (rate limits, `turn/diff/updated`, review) and a `ClaudeSdkDriver` (in-process MCP, `rewindFiles`).
- **Last-resort fallback for any agent:** a PTY "Terminal" mode that runs the interactive CLI unmodified. That is Claude Squad and Superset's approach: maximally compliant, minimally structured.

### 1.5 How existing apps do it

| App | Agent integration | Auth | Isolation / git | Notes for codesigner |
|---|---|---|---|---|
| **Zed** | ACP client. External agents installed from the ACP Registry (`agent_servers` in settings for custom ones) | "Claude Agent owns its auth and billing", via `/login` in the thread (terminal auth). Codex: ChatGPT login / API keys | Editor buffers; no worktrees | Reference ACP client. Agents own auth. Debug with `dev: open acp logs`. |
| **Conductor** (Mac) | Runs Claude Code ("bundled Claude Code binary or a configured system Claude Code binary") and Codex | Supports Pro/Max subscription. "does not bill or meter" usage. Warns that `ANTHROPIC_API_KEY` overrides the subscription | Worktree per workspace. **Checkpoints: before each agent response it captures the working-branch state "in a private Git ref"**; revert deletes later messages | Copy the private-ref checkpoint design. |
| **Crystal → Nimbalyst** | Crystal (Electron) ran Claude Code and Codex sessions in worktrees; retired Feb 2026 in favor of Nimbalyst (MIT) | Bring your own Claude Code / Codex subscription | Optional worktrees | Electron + worktrees + BYO subscription works in practice. |
| **Claude Squad** | TUI. Each agent is an interactive CLI in tmux | Whatever the CLI has | Worktree per session | PTY approach: zero protocol work, no structured UI. |
| **Superset** | Desktop app with persistent terminals; agent-agnostic (Claude Code, Codex, Cursor Agent, OpenCode, Gemini...) | CLI-owned | Worktree per agent | Same PTY pattern plus diff review and browser. ELv2. |
| **Sculptor** (Imbue) | UI for Claude Code (MIT) | CLI-owned | Containers + worktrees; "Pairing Mode" syncs agent code to your IDE bidirectionally | Sync-back is a design option for a separate-worktree mode. |
| **Vibe Kanban** | Executors spawn agent CLIs per task attempt (e.g., `npx -y @anthropic-ai/claude-code`) [secondary] | CLI-owned | Worktree per task attempt; reportedly runs agents with skip-permissions by default [secondary] | Kanban of parallel attempts. |
| **Onlook** | Visual editor for React/Next. **Own AI backend** (AI SDK; OpenRouter/Morph fast-apply) [secondary]; not BYO subscription | App's keys | Injects `data-oid` attributes at build time to map DOM to JSX [secondary] | Closest product analog. Its source mapping is the equivalent of Svelte's dev `__svelte_meta` (§2). |
| **opcode (ex-Claudia)** | Tauri GUI over the `claude` CLI; reads `~/.claude/projects/*.jsonl` for history [from prior knowledge, unverified for 2026] | CLI-owned | Own checkpoints | Shows that GUI-over-CLI is viable. |
| **Cline** | VS Code agent with its own loop (BYO API keys); also offers Claude Code as a provider by spawning the CLI [prior knowledge, unverified]; listed as an ACP agent | Mixed | **Shadow git repo** for checkpoints [prior knowledge] | The shadow-repo checkpoint idea. |
| **stagewise / Agentation / React Grab / MCP Pointer / Vibe Annotations** | Element-to-agent context tools. Agentation: dev-only React toolbar + MCP server (default port 4747) with tools to fetch *pending annotations* and *resolve* them; captures selector, component name, computed styles, note [secondary] | n/a | n/a | Direct prior art for codesigner Comments over MCP. |

**Patterns:**
- (a) **Embedded PTY** running the unmodified interactive CLI: Claude Squad, Superset. Most compliant, least integrated.
- (b) **Structured protocol** (ACP, stream-json, app-server): Zed, Conductor, Nimbalyst. Rich UI.
- Worktree-per-agent is near-universal for *parallel* agents. Checkpoints are almost always **app-owned git snapshots**, not the agent's own.

---

## 2. Context passing and the codesigner MCP server

### 2.1 What the agent should receive

Use push and pull together:
- **Push**, inline in each prompt: a compact `<codesigner_context>` block, plus an optional image attachment of the selection.
- **Pull**, via MCP tools, for anything larger or for when the agent wants fresh state mid-turn (after its edits hot-reload).

Selection payload:

```json
{
  "route": {"path": "/pricing", "routeId": "/(marketing)/pricing", "params": {}},
  "viewport": {"width": 1280, "height": 800, "dpr": 2, "breakpoint": "lg"},
  "element": {
    "source": {"file": "src/lib/components/PricingCard.svelte", "line": 42, "column": 5},
    "component": "PricingCard",
    "componentStack": ["+page.svelte", "PricingGrid.svelte", "PricingCard.svelte"],
    "tag": "a", "role": "link", "accessibleName": "Start free trial",
    "selector": "main section:nth-of-type(2) article:nth-child(1) a.cta",
    "textSnippet": "Start free trial",
    "classes": ["cta", "btn"],
    "computedStyles": {"display": "inline-flex", "padding": "8px 16px", "background-color": "rgb(17,24,39)", "font": "600 14px/20px Inter"},
    "box": {"x": 312, "y": 640, "width": 180, "height": 40},
    "instance": {"index": 0, "count": 3}
  },
  "screenshot": {"tool": "get_canvas_screenshot", "cropId": "sel_01J..."}
}
```

**Source location in SvelteKit dev builds.**
- Svelte's dev runtime attaches `element.__svelte_meta = { loc: { file, line, column } }` to DOM elements, through the internal `assign_location` helper. `@sveltejs/vite-plugin-svelte-inspector` reads it to open the editor.
- This is **internal and unversioned [secondary; verify on the pinned Svelte 5 version]**. Wrap it behind an adapter.
- Fallback: a compile-time preprocessor that injects `data-cs-loc="file:line:col"`, which is Onlook's approach.
- Known pitfall: line drift with `svelte-preprocess` + `lang="ts"`. `vitePreprocess` is fine.
- Elements produced inside `{#each}` share one `loc`. Always send `instance.index` / `count` and a text snippet, so the agent knows whether "this card" means one instance or the component.

**Computed styles:** send a curated subset (layout, spacing, typography, color, border, radius, shadow), not all ~350 properties. Map values back to design tokens when possible (`bg-gray-900`, `var(--color-primary)`).

**Images:**
- Claude: base64 `image` blocks (stream-json or ACP).
- ACP: `{type:"image", mimeType, data}`.
- Codex app-server: `{type:"localImage", path}`.
- Cursor: verify image support in ACP prompts.
- Keep crops ≤ ~1500 px on the long edge.

### 2.2 MCP server design ("codesigner-mcp")

**Transport and security:**
- One MCP server in the Electron main process, using `@modelcontextprotocol/sdk` 1.32.1 with **streamable HTTP** on `127.0.0.1:<random port>`.
- Mint a **per-agent-session bearer token**. The token maps to `{projectId, worktreePath, agentSessionId}`, so tool calls know which canvas and which session they belong to.
- **Reject any request with an `Origin` header** (DNS-rebinding and browser CSRF), and bind to loopback only.
- Ship a tiny stdio shim (`codesigner-mcp --stdio`, which proxies to HTTP) for agents or configs that only accept stdio.
- For the Claude SDK path, an in-process `createSdkMcpServer` needs no port at all.

**Tools.** Keep the read tools auto-approved and gate mutating tools.

| Tool | Input | Output | Notes |
|---|---|---|---|
| `get_selection` | – | Selection JSON (§2.1), or `null` | Current canvas selection; multi-select returns an array. |
| `get_canvas_screenshot` | `{scope: "selection"\|"viewport"\|"fullPage", route?, viewport?}` | MCP `image` content (PNG/WebP) + metadata | Lets the agent visually verify after HMR. |
| `get_element` | `{source?: {file,line,column}, selector?}` | Element JSON incl. computed styles | Resolve arbitrary elements. |
| `list_comments` | `{status?: "open"\|"resolved"\|"all", route?, file?}` | Summaries (id, route, anchor.source, first message, status) | |
| `get_comment` | `{id}` | Full comment incl. thread + crop image | |
| `reply_to_comment` | `{id, body}` | ok | Agent explains what it did or asks a question. |
| `resolve_comment` | `{id, summary, files?: string[]}` | ok | Sets status resolved with `resolution.agentSessionId` and the turn checkpoint ref. The app can require user confirmation ("agent proposes resolve"). |
| `get_routes` | – | SvelteKit route tree (`src/routes` → routeId, file, params, layout chain) | |
| `get_design_tokens` | – | Tokens from Tailwind config / CSS custom properties / theme files | Encourages token use over magic numbers. |
| `get_component_tree` | `{route?}` | Component hierarchy with source files | |
| `get_dev_server_errors` | `{since?}` | Vite/SvelteKit compile errors, browser console errors from the canvas | Very high value: closes the loop after agent edits. |
| `navigate_canvas` / `highlight_element` | `{route}` / `{source\|selector}` | ok | The agent can show the user what it means. Optional. |
| `approve_tool` | `{tool_name, input, tool_use_id}` | `{"behavior":"allow"\|"deny", ...}` | Only for the raw-`claude -p` path's `--permission-prompt-tool`. Not exposed via ACP. |

Resources (optional): `codesigner://selection`, `codesigner://comments/{id}`, `codesigner://routes`.

### 2.3 Registering the MCP server per agent without polluting global config

| Agent | Preferred (ephemeral) | Fallback |
|---|---|---|
| Claude (ACP) | `session/new.mcpServers` with `type:"http"` + `headers` | – |
| Claude (raw CLI) | `--mcp-config '<inline JSON>'` (+ `--allowedTools mcp__codesigner`). Avoid `--strict-mcp-config` unless the repo is untrusted, so the user's own servers keep working. | `--settings` inline JSON |
| Claude (SDK) | `mcpServers: { codesigner: { type: "sdk", instance } }` or `{type:"http", url, headers}` | – |
| Codex (ACP) | `session/new.mcpServers` (codex-acp supports "client-provided MCP servers over command-based stdio and HTTP"), or `CODEX_CONFIG` JSON env | – |
| Codex (app-server / exec) | `-c 'mcp_servers.codesigner.url="..."' -c 'mcp_servers.codesigner.bearer_token_env_var="CODESIGNER_MCP_TOKEN"'` [unverified for MCP keys]; possibly `thread/start` config [unverified] | Project `.codex/config.toml` in the worktree (trusted projects only) + `.git/info/exclude` |
| Cursor (ACP) | `session/new.mcpServers` (fixed per staff 2026-10-04; **probe at startup**: call a no-op `codesigner.ping` tool and check that it shows up) | Write `<worktree>/.cursor/mcp.json`, add it to `.git/info/exclude`, remove it on session end. Last resort: `~/.cursor/mcp.json` (global; ask the user). |

Never edit `~/.claude.json`, `~/.claude/settings.json`, `~/.codex/config.toml` or `~/.cursor/mcp.json` without explicit consent. Use `.git/info/exclude` (local, uncommitted) rather than `.gitignore` for any temporary files.

### 2.4 System instructions

- Claude: `--append-system-prompt-file`, the SDK `systemPrompt.append`, or the adapter's `systemPrompt` session capability.
- Codex / Cursor: prepend a short preamble to the first prompt. Codex-specific `developer_instructions` config is [unverified].

Content:
- "You are editing a SvelteKit app shown live on a canvas."
- "Prefer design tokens."
- "Don't run the dev server; it's already running."
- "Call `get_dev_server_errors` after edits."
- "Call `resolve_comment` when you address a comment."
- "Keep changes minimal and local to the referenced source location."

---

## 3. Git and worktree workflow (agent + human, concurrently)

### 3.1 Same worktree or separate?

- **Default: the same worktree the canvas previews.** The core promise is "changes appear live on the canvas". The dev server (Vite HMR) watches that tree.
- **Optional "background agent" mode:** a separate worktree with its own dev server on another port, shown as a second canvas tab. Merge back on accept, as Conductor, Superset and Vibe Kanban do. This mode enables parallel attempts ("try 3 variants").

### 3.2 Write coordination (visual edits in flight)

Put a **WriteCoordinator** in the main process. All canvas writes go through it. It knows when an agent turn is running and which files the agent has touched, from ACP `tool_call.locations` and diffs, Codex `item/fileChange`, and the fs watcher.

During an agent turn:
1. Canvas edits to files **not** touched by the agent this turn apply immediately. AST patch via the canvas's normal path, then a `before/after` content-hash check.
2. Canvas edits to files the agent **has** touched are **queued**. The UI shows "applies after the agent finishes". After the turn, they are re-applied by re-resolving the node via its anchor (§4.3), not by stale offsets.
3. Every canvas write is a compare-and-swap: re-read the file, verify the hash the canvas parsed from, otherwise re-parse and re-locate before writing.
4. Simplest MVP alternative: make the canvas **read-only during a turn**, with a "Stop agent" button. Ship this first and add queuing later.

The fs watcher (`@parcel/watcher` or chokidar) on the worktree:
- Debounce at ~50–100 ms. Ignore `.git`, `node_modules`, `.svelte-kit`, `.codesigner/local`.
- On change: re-parse affected `.svelte` / `.ts` / `.css` into the canvas model, re-resolve the current selection and comment anchors, and update the layers panel.
- HMR updates the iframe by itself. The app only needs to refresh its source model.

### 3.3 Checkpoints: app-owned private refs (Conductor pattern)

Agent-native checkpoints are insufficient:
- **Claude Code** rewind doesn't track Bash-made changes or most subagent edits, and doesn't capture external (canvas) edits [verified, [checkpointing docs](https://code.claude.com/docs/en/checkpointing)].
- **Cursor** checkpoints don't exist in the CLI and are reported flaky in the IDE [secondary, forum].
- **Codex** has `thread/revert` in app-server [verified it exists; semantics unverified].

Snapshot the whole working tree without touching the user's index or branch:

```bash
# pre-turn snapshot (run in worktree)
mkdir -p "$(git rev-parse --git-dir)/codesigner"
export GIT_INDEX_FILE="$(git rev-parse --git-dir)/codesigner/index"
git read-tree HEAD                       # seed temp index from HEAD
git add -A                               # stage everything into the TEMP index (respects .gitignore)
TREE=$(git write-tree)
PRE=$(git commit-tree "$TREE" -p HEAD -m "codesigner: pre turn $TURN ($AGENT, session $SID)")
git update-ref "refs/codesigner/sessions/$SID/turns/$TURN/pre" "$PRE"
unset GIT_INDEX_FILE
# ... agent turn runs ...
# post-turn: same, parent = PRE  -> refs/.../post
```

- **Show the turn diff:** `git diff $PRE $POST`. Use Codex's `turn/diff/updated` for a live preview while the turn runs.
- **Undo a turn:** `git diff --binary $POST $PRE | git apply --3way`. This reverse-applies only the agent's changes and **preserves human or canvas edits made after the turn**. On conflict, show a merge UI.
  - `--binary` is required, or image/asset changes (e.g. in `static/`) come out as unappliable "Binary files differ".
  - `git apply --3way` has historically implied `--index`, so it can stage changes into the user's real index. Run it with the same temporary `GIT_INDEX_FILE` (seeded via `git read-tree` from a fresh snapshot of the current tree), or implement the 3-way merge per file with `git merge-file` **[verify on the target git version]**.
  - If nothing changed since `POST`, a fast path restores the tree exactly: `git checkout $PRE -- .` plus deleting files added in the turn.
- **Attribution:** take an extra "human" snapshot before applying queued canvas edits, so human and agent changes stay separable in history.
- **Retention:** prune refs older than N days or M turns with a `git for-each-ref` sweep. The refs are local only and never pushed.
- **Promotion to real history:** "Save version" (the existing version-control feature) creates a normal commit on the branch. Optionally, offer "commit this agent turn" with the agent's final message as the body and trailers:

  ```
  Codesigner-Agent: claude
  Codesigner-Session: 6f1c...
  Resolves-Comment: c_01J...
  ```

- Also roll the agent conversation back when undoing:
  - Claude: `--resume <id> --fork-session` from the message before the turn, or `rewindFiles` on the SDK path.
  - ACP: `session/fork` where supported.
  - Otherwise, tell the agent "the previous change was reverted by the user".

### 3.4 Concurrency hazards to handle

- Agent runs `git checkout`, `git stash`, `git reset`, or commits. Default to denying `Bash(git checkout *)`, `Bash(git reset *)`, `Bash(git stash *)` and `Bash(git commit *)` via permissions. codesigner owns git.
- Agent runs `npm run dev` (port clash). Deny it via rules and the system prompt. Expose `get_dev_server_errors` instead.
- Lockfile and package changes. Detect them and prompt "restart dev server?".
- Formatter churn (the agent runs prettier on whole files, which changes anchors). The comment re-anchoring in §4.3 tolerates it.

---

## 4. Comments data model

### 4.1 Requirements

- Anchored to a DOM element on a route, as in Figma or Claude Design comments.
- Survive code edits, reformatting, and moved components.
- Live in the repo so teammates and agents can read them via git.
- Support threads, resolve state, and "send to agent" one at a time or "implement all unresolved".

### 4.2 Storage layout

```
.codesigner/
  comments/
    c_01JAB3XK9Q2F8.json        # one file per comment => no merge conflicts between teammates
    assets/
      c_01JAB3XK9Q2F8.webp      # small crop (<= ~100 KB); optional, can be disabled or LFS
  config.json                   # project settings (tracked)
  local/                        # ignored: session index, screenshot cache, MCP tokens, checkpoint metadata
```

- `.codesigner/local/` goes into `.gitignore` (the app offers to add it), or into `.git/info/exclude`.
- Use ULIDs for ids (sortable, merge-safe). Pretty-print with stable key order to keep diffs small.

### 4.3 Comment schema (v1)

```json
{
  "schema": "codesigner.comment/v1",
  "id": "c_01JAB3XK9Q2F8",
  "status": "open",
  "createdAt": "2026-10-18T14:03:11Z",
  "updatedAt": "2026-10-18T14:20:45Z",
  "author": {"name": "Anthony", "email": "anthony@example.com"},
  "anchor": {
    "route": {"path": "/pricing", "routeId": "/(marketing)/pricing", "params": {}, "search": ""},
    "viewport": {"width": 1280, "height": 800, "dpr": 2, "breakpoint": "lg", "colorScheme": "light"},
    "source": {
      "file": "src/lib/components/PricingCard.svelte",
      "line": 42, "column": 5,
      "component": "PricingCard",
      "componentStack": ["src/routes/(marketing)/pricing/+page.svelte", "src/lib/components/PricingGrid.svelte"],
      "commit": "a1b2c3d",
      "blob": "9f8e7d6c5b4a..."
    },
    "dom": {
      "tag": "a", "id": null, "testId": "pricing-cta",
      "role": "link", "accessibleName": "Start free trial",
      "classes": ["cta", "btn"],
      "selector": "main section:nth-of-type(2) article:nth-child(1) a.cta",
      "textSnippet": "Start free trial",
      "siblingIndex": 2,
      "instance": {"index": 0, "count": 3}
    },
    "pin": {"xPct": 0.82, "yPct": 0.35},
    "rect": {"x": 312, "y": 640, "width": 180, "height": 40},
    "screenshot": "assets/c_01JAB3XK9Q2F8.webp"
  },
  "appliesTo": "instance",
  "thread": [
    {"id": "m_01", "author": {"name": "Anthony"}, "kind": "human", "createdAt": "2026-10-18T14:03:11Z",
     "body": "CTA should use the primary button style and be full width on mobile."},
    {"id": "m_02", "author": {"name": "Claude", "agent": "claude"}, "kind": "agent", "createdAt": "2026-10-18T14:20:40Z",
     "body": "Switched to <Button variant=\"primary\"> and added w-full below md."}
  ],
  "resolution": {
    "resolvedAt": "2026-10-18T14:20:45Z",
    "resolvedBy": {"name": "Claude", "agent": "claude"},
    "agentSessionId": "6f1c...",
    "checkpoint": "refs/codesigner/sessions/6f1c/turns/3/post",
    "commit": null,
    "note": "Verified at 375px and 1280px."
  },
  "anchorState": {"status": "attached", "lastResolvedAt": "2026-10-18T14:20:45Z", "confidence": 0.97}
}
```

- `status`: `open | resolved | wontfix`.
- `appliesTo`: `instance | component`. Whether the comment targets this specific item or every instance.
- `anchorState.status`: `attached | moved | outdated | detached`.

### 4.4 Re-anchoring algorithm (run on load, on file change, and on route navigation)

1. **Route:** match `routeId` (and params when they matter). If there is no match, the comment is "on another page", listed in the sidebar with a jump link.
2. **Source location:** if `blob` equals the file's current blob, use `file:line:col` directly. Otherwise map the old line through `git diff <blob> <current>` hunks, as GitHub does with review comments. Then find DOM nodes whose `__svelte_meta.loc` (or `data-cs-loc`) matches.
   - If the file was renamed, follow `git log --follow -M` from `commit`.
3. **Stable DOM signals:** `testId`, then `id`, then role + accessible name.
4. **Structural:** the stored `selector`, scoped within the component's root nodes.
5. **Fuzzy:** score candidates by text-snippet similarity, tag, class overlap, and ancestor path similarity. Pick `instance.index` among equals.
6. Score ≥ threshold → `attached` (or `moved`, if the location changed; update `source` lazily on next save or resolve to avoid churn). Score below threshold → `outdated`: show the last-known screenshot crop and a "re-pin" action. Never silently drop a comment.

### 4.5 Sending comments to the agent

**One comment:** the prompt includes the comment JSON (minus base64), the crop image, and the instruction to call `resolve_comment` when done.

**"Implement all unresolved comments":**
- **Default:** the app orchestrates **one comment per agent turn**, sequentially, in one agent session. This gives per-comment checkpoints and diffs, granular undo, and clear `Resolves-Comment` attribution. Group comments only when they share a component (`source.file`), or when the user picks "single pass".
- **Ordering:** by route, then by file, then by creation time.
- **Skip** comments whose `anchorState` is `outdated`. Report them.
- **Stop** on the first failed build (`get_dev_server_errors`), or ask.

Prompt template (per batch, or per comment with N=1):

```text
You are working in a SvelteKit app that is displayed live on the codesigner canvas.
The dev server is already running; do not start it. Do not run git commands; codesigner manages version control.

Implement the following design review comment(s). For EACH comment:
1. Locate the element. Start at source.file:line:col; use dom.textSnippet / dom.selector to disambiguate.
   If appliesTo = "component", change the component for all instances; if "instance", change only that usage.
2. Make the smallest change that satisfies the comment. Prefer existing components and design tokens
   (call get_design_tokens if unsure). Keep behaviour and accessibility intact.
3. Verify: call get_dev_server_errors; if the comment is visual, call get_canvas_screenshot
   (scope "selection", the comment's route and viewport) and check the result.
4. Call resolve_comment with {id, summary, files}. If the request is ambiguous or conflicts
   with another comment, call reply_to_comment with a question instead and do NOT resolve it.

<comments>
<comment id="c_01JAB3XK9Q2F8" route="/pricing" viewport="1280x800" appliesTo="instance">
  <source file="src/lib/components/PricingCard.svelte" line="42" col="5" component="PricingCard"/>
  <element tag="a" role="link" name="Start free trial" testId="pricing-cta"
           selector="main section:nth-of-type(2) article:nth-child(1) a.cta"/>
  <thread>
    <message author="Anthony">CTA should use the primary button style and be full width on mobile.</message>
  </thread>
  [image: crop of the element]
</comment>
</comments>

When finished, reply with a short list: comment id -> what changed (files) or why it was not resolved.
```

### 4.6 Team and git interplay

- Comments merge cleanly because each lives in its own file. Concurrent edits to the same comment's thread can conflict. Optionally ship a `.gitattributes` custom merge driver for `*.json` thread arrays later. Rare in practice.
- Resolved comments stay in the repo for history. Archive by moving them to `.codesigner/comments/archive/` or deleting them (git keeps history).
- Agents **without** the MCP server (e.g., a teammate's plain Claude Code) can still read `.codesigner/comments/*.json` from the repo. Add a short `.codesigner/README.md` (the app generates it on project init) that explains the schema, so any agent can act on comments.

---

## 5. RECOMMENDED APPROACH

1. **Architecture.**
   - The main process hosts an `AgentManager` with an `AgentDriver` interface.
   - The first implementation is `AcpDriver`, built on `@agentclientprotocol/sdk` (fluent `client()` API). It spawns adapters with Electron's Node (`ELECTRON_RUN_AS_NODE=1`).
   - The renderer's Agent tab renders ACP `session/update`s: message chunks, tool-call cards with diff previews, a permission modal driven by `session/request_permission`, and a mode switcher (Ask / Plan / Edit / Auto) driven by `session/set_mode`.
2. **Agents, in order:**
   1. **Claude** via `@agentclientprotocol/claude-agent-acp` (pin, ~0.93.x).
      - `CLAUDE_CODE_EXECUTABLE` = the user's `claude`, resolved from the login shell.
      - Exclude the SDK's optional native binaries from the app bundle.
      - Strip `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` unless the user chose API billing.
      - Don't declare terminal-auth. Gate on `claude auth status` and tell the user to run `claude auth login` themselves.
   2. **Codex** via `@agentclientprotocol/codex-acp` (pin, ~2.2.x).
      - `CODEX_PATH` = the user's `codex` if installed, else the bundled one (Apache-2.0).
      - ChatGPT login through the adapter's auth method, which is Codex's own flow.
      - Later, consider a direct `codex app-server` driver for rate-limit display and `turn/diff/updated`.
   3. **Cursor** via native `agent acp`.
      - Startup probe for MCP injection, with the `.cursor/mcp.json` + `.git/info/exclude` fallback.
      - Keep its own session index, since there's no `session/list`.
   4. **Fallback:** a "Terminal" sub-tab that runs any agent CLI interactively in a PTY (xterm.js + node-pty), with the MCP server URL offered for manual registration.
3. **Compliance UX (Claude).**
   - Settings → Agents shows "Claude: using your Claude Code CLI login (plan usage applies)", with detected version and auth method.
   - No token handling, no in-app OAuth, no bundled `claude`.
   - Branding "Claude", not "Claude Code".
   - Keep the API-key / Bedrock path available.
   - Re-check the [legal page](https://code.claude.com/docs/en/legal-and-compliance) before each release. Consider asking Anthropic sales/partnerships for written confirmation before a public launch.
4. **Context.**
   - One codesigner MCP server: streamable HTTP, loopback, per-session bearer token, `Origin` rejected. Tools as listed in §2.2.
   - Injected per session via ACP `session/new.mcpServers`. Never written to global configs.
   - Every prompt includes a compact `<codesigner_context>` selection block plus an optional crop image.
5. **Git.**
   - The agent runs in the canvas worktree.
   - The WriteCoordinator serializes writes. MVP: canvas read-only during a turn.
   - Pre- and post-turn snapshots go to `refs/codesigner/sessions/<sid>/turns/<n>/{pre,post}` via a temporary index.
   - "Undo turn" = 3-way reverse apply.
   - Turn diff panel from `git diff pre post`.
   - Deny agent git-mutating and dev-server Bash commands by default.
   - Optional background-agent mode in a separate worktree with its own preview.
6. **Comments.**
   - `.codesigner/comments/<ulid>.json` (tracked) with the multi-signal anchor and threads from §4.3.
   - Re-anchoring pipeline from §4.4, with an `outdated` state.
   - MCP tools `list_comments` / `get_comment` / `reply_to_comment` / `resolve_comment`.
   - "Implement all unresolved" = app-orchestrated, one comment per turn by default, each with its own checkpoint and optional commit trailer `Resolves-Comment:`.
7. **Security.**
   - A workspace-trust prompt before the first agent run in a repo. Project hooks and MCP configs run without prompts in headless agent modes.
   - Default permission mode "accept edits" + ask for shell.
   - Never "bypass" without an explicit per-session toggle.

**Milestones:**
- M1: Claude via ACP + MCP `get_selection`/`get_canvas_screenshot` + checkpoints + read-only-canvas-during-turn.
- M2: Comments + resolve tools + "implement all".
- M3: Codex via codex-acp.
- M4: Cursor via `agent acp`, plus the PTY fallback.
- M5: concurrent canvas edits (queue/CAS) and background worktree mode.

---

## 6. Open questions and items to verify before building

- [ ] Whether the Claude Agent SDK / claude-agent-acp keeps reading subscription OAuth once `--bare` becomes the `-p` default. Track the SDK changelog and pin versions.
- [ ] Whether Anthropic considers a GUI that launches `claude auth login` (terminal-auth) "offering Claude.ai login". Current plan: avoid it.
- [ ] `codex -c mcp_servers.<name>.*` overrides, and MCP via `thread/start` config. Test against 0.163.x.
- [ ] Cursor ACP: `session/new.mcpServers` honored on the current build? Image prompts supported? Session load semantics?
- [ ] Cursor `stream-json` event schema (only needed if not using ACP).
- [ ] Svelte 5 `__svelte_meta.loc` shape on the pinned Svelte version. Decide between it and a `data-cs-loc` preprocessor.
- [ ] codex-acp session load/resume behavior (the README lists it only for subagents).
- [ ] The `--permission-prompt-tool` response contract on the pinned Claude CLI (only for the raw-CLI fallback).

---

## 7. Sources

Primary (fetched 2026-10-18):
- Claude Code — Legal and compliance: https://code.claude.com/docs/en/legal-and-compliance
- Claude Code — Authentication (precedence, setup-token, credential storage): https://code.claude.com/docs/en/authentication
- Claude Code — Run programmatically / headless (`-p`, stream-json, `--bare`, trust caveats): https://code.claude.com/docs/en/headless
- Claude Code — CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude Code — Checkpointing: https://code.claude.com/docs/en/checkpointing
- Claude Agent SDK overview (auth note, branding): https://code.claude.com/docs/en/agent-sdk/overview
- Claude Agent SDK TypeScript reference: https://code.claude.com/docs/en/agent-sdk/typescript
- Support — Use the Claude Agent SDK with your Claude plan (pause + Oct 7 update): https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- Codex app-server: https://learn.chatgpt.com/docs/app-server (redirect from developers.openai.com/codex/app-server)
- Codex non-interactive mode: https://learn.chatgpt.com/docs/non-interactive-mode
- Codex MCP: https://learn.chatgpt.com/docs/extend/mcp.md?surface=cli
- Cursor CLI headless: https://cursor.com/docs/cli/headless
- Cursor CLI ACP: https://cursor.com/docs/cli/acp
- Cursor CLI MCP: https://cursor.com/docs/cli/mcp
- Cursor forum — MCP via `session/new` in ACP: https://forum.cursor.com/t/mcp-servers-passed-via-session-new-dont-work-in-acp-mode/153823
- Cursor forum — project mcp.json not picked up: https://forum.cursor.com/t/cursor-agent-not-picking-up-mcp-json-from-project/157026
- Cursor forum — ACP `session/list`: https://forum.cursor.com/t/acp-support-session-list-method/156222
- ACP — agents list: https://agentclientprotocol.com/get-started/agents
- ACP — protocol overview / session setup / tool calls: https://agentclientprotocol.com/protocol/overview, https://agentclientprotocol.com/protocol/session-setup, https://agentclientprotocol.com/protocol/tool-calls
- ACP — TypeScript library: https://agentclientprotocol.com/libraries/typescript
- claude-agent-acp: https://github.com/agentclientprotocol/claude-agent-acp (npm `@agentclientprotocol/claude-agent-acp` 0.93.0; source inspected)
- codex-acp: https://github.com/agentclientprotocol/codex-acp (npm `@agentclientprotocol/codex-acp` 2.2.2)
- Zed external agents: https://zed.dev/docs/ai/external-agents
- Conductor — Claude Code harness: https://www.conductor.build/docs/reference/harnesses/claude-code
- Conductor — Checkpoints: https://www.conductor.build/docs/reference/checkpoints
- vite-plugin-svelte inspector: https://github.com/sveltejs/vite-plugin-svelte/blob/main/docs/inspector.md

Secondary:
- Anthropic OAuth crackdown coverage: https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block/ , https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/ , https://natural20.com/coverage/anthropic-banned-openclaw-oauth-claude-code-third-party , https://decodethefuture.org/en/anthropic-blocks-third-party-tools/
- Sign in with ChatGPT for third-party tools: https://thenewstack.io/sign-in-with-chatgpt/ ; Codex subscription in harnesses: https://codex.danielvaughan.com/2026/04/24/codex-subscription-api-programmatic-access-gpt-5-5-chatgpt-plan/
- codex exec JSONL reference: https://codex.danielvaughan.com/2026/04/08/codex-exec-jsonl-reference/
- Superset vs Sculptor / Claude Squad: https://superset.sh/compare/superset-vs-sculptor , https://superset.sh/compare/superset-vs-claude-squad ; Sculptor: https://imbue.com/sculptor
- Vibe Kanban docs: https://vibekanban.com/docs/core-features/monitoring-task-execution
- Crystal → Nimbalyst: https://github.com/stravu/crystal , https://www.sitepoint.com/nimbalyst-the-visual-workspace-for-building-with-claude-code-and-codex/
- Onlook architecture: https://docs.onlook.com/developers/architecture
- stagewise DOM context selector: https://docs.stagewise.io/features/dom-context-selector ; Agentation: https://www.everydev.ai/tools/agentation ; React Grab: https://www.mintlify.com/aidenybai/react-grab/introduction
- Svelte `__svelte_meta` line-drift issue: https://github.com/sveltejs/svelte-preprocess/issues/671
