# Bounded investigation agent

The agent is a program-controlled, single-investigation workflow, not an open-ended autonomous
accountant. It closes a reconciliation **run**, not every exception or the merchant's books.

1. Load the pinned public synthetic three-source batch; reject changed hashes, missing manifest
   or extra settlement entities. Run deterministic Vouch: 1,083 rows, 24 settlements, 9 proved.
2. Select the unresolved investigation scope: 3 bank entries and 4 candidate settlements in the
   current sample. Supply public evidence, allowed literal spans and a structured response schema.
3. Invoke Gemini once on the hosted server, or the optional local Codex CLI adapter. The model proposes only;
   at most 12 proposals can enter verification. Empty output is a valid abstention.
4. Reject invented scope, duplicate proposal IDs, unoffered spans, omitted required tests or
   oversized output. Run core checks and global matching. A verified candidate is not automatically
   an accepted match. Any orchestration failure accepts no new AI result and never substitutes replay.
5. Return the final artifact, every exception and an exportable provenance/event trace. The browser
   independently recomputes the result from source rows and proposals before displaying it.

## Hosted Gemini live mode

On **Agent run**, enter the builder-provided **demo access code**, then choose **Run live Gemini
agent**. This is a fresh API call, not the Codex recording. The UI shows hosted availability and
remaining attempts. Live results may differ from replay; all returned proposals undergo the same
scope checks, exact literal-citation verification and independent browser recomputation.

The selected model is `gemini-3.5-flash` with low thinking effort. The exact credential-free wire
request is included in the session alongside the strict verification schema. The provider schema
omits string/array length bounds to keep its generation grammar tractable; Vouch still enforces
proposal, span, byte and schema limits independently. The transport uses the REST
`responseFormat.text.mimeType: APPLICATION_JSON` enum, not the SDK's MIME-string shorthand.

September 5 integration smoke test: the provider reported `gemini-3.5-flash`, returned two proposals
in 10,630 ms and reported 3,633 total tokens. Independent verification proved 10/24 settlements,
retained 25 exception records and accounted for all 1,083 rows at zero accepted residual. Cost was
not reported. This was a development integration check, not an evaluation or guaranteed future
response. Earlier provider-compatibility checks failed closed; they produced no accepted AI result.

Server requirements: `GEMINI_API_KEY` and `VOUCH_AGENT_ACCESS_CODE` configured as secret runtime
environment variables, and the logical D1 binding `DB` with the generated `drizzle/` migrations.
Keep both secrets out of Git, browser bundles and URLs. `.env.local` at the repository root is an
ignored private credential handoff, not an automatic production configuration. Configure the
server secrets through the hosting service and deploy to apply them. Never use a `NEXT_PUBLIC_`
prefix. Give judges only the separate access code, through their private access instructions.

Only a same-origin JSON POST with body `{}` and the access-code header is accepted. No request can
supply source files, prompts, model settings or URLs. The model receives only the bounded packet
derived from the pinned, bundled public synthetic sample. The API key is sent only in a header to
Google's fixed GenerateContent endpoint. Uploaded merchant-file reconciliation remains AI-off.

Limits are global across visitors and server instances: **50 total attempts**, one active request,
a 30-second cooldown, a 60-second provider timeout and 4,096 output tokens. A conditional D1 write
reserves an attempt before invoking the model. Failed and uncertain attempts count; there are no
automatic retries or refunds. The 90-second lease lets a crashed run expire. If the database is
unavailable, no model call is made. These limits do not reset daily or on redeploy, and do not
guarantee a fixed monetary cost. Google quotas and billing controls still apply independently.

The access code is a shared bearer capability, not named-user authentication. Keep it private;
anyone who has it can consume the remaining allowance. It lives only in browser memory and is
not saved to local storage. Rotate its server secret to revoke the old code. D1 stores only the
attempt counter, cooldown and lease: no keys, source records or model responses. The fresh session
is returned to the caller and may be exported; it does not overwrite the reviewed recording.

## Optional local Codex live mode

```bash
codex login
pnpm dev
# In another terminal, at the repository root:
pnpm agent
```

Open `http://localhost:3000`, select Agent run, expand Local Codex companion, then Run local Codex
agent. The companion listens only on
`127.0.0.1:4318`. Exact Host and approved localhost Origin checks, an explicit custom-header JSON
POST with body `{}`, single-flight execution, a 30-second cooldown and three attempts per process
limit access. No request may supply files, paths, prompts, provider settings or command arguments.
Request IDs prevent one tab from accepting another tab's result.

This is a local-development access boundary, not multi-user authentication. Other software running
as the same OS user can invoke the companion. Do not expose it through a tunnel or reverse proxy.
Restarting the companion resets its in-memory call limit; that is not a durable account spend cap.

The adapter reuses the user's local ChatGPT login, forces ChatGPT authentication, removes provider
API keys from its child environment, disables shell/apply-patch/multi-agent/JS-REPL tools and web
search, runs read-only in a temporary directory, and ignores user configuration/rules. It does not
publish credentials. No raw provider events, hidden reasoning or raw provider errors reach the UI.
The model request timeout is 120 seconds (plus a separate 15-second CLI version check), output is
limited to 20 MiB, accepted proposals to 64 KiB, and the browser verification worker to 15 seconds.
`max_output_tokens` is a capture request setting, **not an enforced Codex CLI token or cost cap**.
Live runs use Codex allowance; no extra paid API provider is enabled by this workflow.

## Public replay and evidence

Without a demo access code, the public site can still replay the reviewed original proposals in
`apps/web/public/data/agent-session.json`, anchored by the reviewed hash in `agent-recording.ts`.
Source/configuration binding and self-hash validation precede independent verification. Replay
uses `aiMode: replay`; hosted Gemini and local Codex fresh responses use `aiMode: live`. All modes
rerun the same engine. No failed live call silently falls back to the recording.

The September 5 recording returned 2 proposals: 1 candidate verified and 1 rejected for posting
outside the configured window; the final result was 9 exact + 1 assisted matches of 24 settlements,
25 exception records, 1,083/1,083 row outcomes and zero accepted residual. Model latency: 20,289 ms;
reported total tokens: 13,385. Requested model: `gpt-5.6-sol`; reported model and cost: unavailable.
Do not represent a requested model as provider-confirmed or unavailable cost as zero.

These observations are not an independent held-out evaluation. The older sealed 7/9/10 benchmark
and its hand-reviewed fixture remain separate; the new recording preserves actual model output.
Local fresh sessions are written to ignored `artifacts/local-agent/` and never automatically replace
the reviewed public recording. A session hash checks content integrity, not provider authenticity.

## Recording

Run the selected live workflow once before recording to check access; do not keep retrying to
manufacture a preferred model result. For a reliable take, use the published recorded-agent mode
and explicitly say it is a recording with fresh verification. For a live take, show the actual live
button and call, and narrate whatever the model really returns. Cuts through waiting time must be
labelled. The script's observed numbers describe the reviewed September 5 run, not guaranteed live output.
