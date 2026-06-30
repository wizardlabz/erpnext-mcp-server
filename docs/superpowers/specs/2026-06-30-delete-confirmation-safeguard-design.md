# Delete Confirmation Safeguard — Design

**Date:** 2026-06-30
**Repo:** wizardlabz/erpnext-mcp-server (fork of rakeshgangwar/erpnext-mcp-server)
**Scope:** `delete_document` tool only. All other tools unchanged.

## Problem

`delete_document` permanently deletes ERPNext records with no confirmation. An agent
can delete data without the user ever being asked. We want the server itself to force a
confirmation handshake for the first deletes in a session, with an explicit user opt-out.

## Behavior

State is held in memory for the lifetime of the MCP server process. One process = one
Claude Code run = one "session". Restarting Claude Code resets all state.

Per-session state:
- `gatePromptCount: number` — how many delete requests have hit the gate this session.
- `skipConfirmations: boolean` — opt-out flag (starts `false`).
- `pendingTokens: Map<string, { doctype, name, ts }>` — outstanding confirm tokens.

`delete_document` gains two optional args (required args `doctype`, `name` unchanged):
- `confirm_token?: string`
- `skip_future_confirmations?: boolean`

Algorithm on each `delete_document` call:

1. If `skipConfirmations === true` → delete immediately; response notes confirmations are
   disabled for the session.
2. Else if no valid `confirm_token` supplied → **BLOCK (do not delete)**:
   - increment `gatePromptCount`
   - generate a single-use token tied to this exact `doctype`+`name`, TTL ~5 minutes,
     store in `pendingTokens`
   - return a warning instructing the agent to: state exactly what will be deleted, get
     explicit user approval, then re-call with the same `doctype`/`name` plus `confirm_token`.
   - **On the 3rd gated delete onward** (`gatePromptCount >= 3`), the warning ALSO tells
     the agent to offer the opt-out: pass `skip_future_confirmations: true` with the token
     to disable the safeguard for the rest of the session.
3. Else (`confirm_token` supplied) → validate it matches the pending `doctype`+`name` and
   is not expired:
   - invalid/expired/mismatched → return an error explaining why, prompting a fresh attempt.
   - valid → consume the token, perform the delete. If `skip_future_confirmations === true`
     was passed, set `skipConfirmations = true` and note future deletes won't be gated.

## Net effect

- Every delete is gated until the user opts out.
- Deletes 1–2: confirm-then-delete.
- Delete 3 onward: confirm-then-delete, and the agent offers "stop asking me this session".
- No unconfirmed delete ever happens unless the user explicitly opts out.
- Backward compatible: existing callers that pass only `doctype`/`name` still work — they
  simply get blocked on the first attempt and must re-call with the returned token.

## Verification

- `npm run build` compiles cleanly.
- Manual exercise against the dev ERPNext instance:
  1. Fresh delete → blocked, token returned.
  2. Re-call with token → deletes.
  3. Reach 3rd gated delete → warning includes opt-out offer.
  4. Opt out → subsequent deletes proceed ungated.
  5. Invalid/expired token → rejected.
