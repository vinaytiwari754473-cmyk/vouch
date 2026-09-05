# Bounded investigation agent

The agent is a program-controlled, single-investigation workflow, not an open-ended autonomous
accountant. It closes a reconciliation **run**, not every exception or the merchant's books.

1. Load the pinned public synthetic three-source batch; reject changed hashes, missing manifest
   or extra settlement entities. Run deterministic Vouch: 1,083 rows, 24 settlements, 9 proved.
2. Select the unresolved investigation scope: 3 bank entries and 4 candidate settlements in the
   current sample. Supply public evidence, allowed literal spans and a structured response schema.
3. Invoke the existing Codex CLI adapter once, requesting `gpt-5.6-sol`. The model proposes only;
   at most 12 proposals can enter verification. Empty output is a valid abstention.
4. Reject invented scope, duplicate proposal IDs, unoffered spans, omitted required tests or
   oversized output. Run core checks and global matching. A verified candidate is not automatically
   an accepted match. Any orchestration failure accepts no new AI result and never substitutes replay.
5. Return the final artifact, every exception and an exportable provenance/event trace. The browser
   independently recomputes the result from source rows and proposals before displaying it.

## Local live mode

```bash
codex login
pnpm dev
# In another terminal, at the repository root:
pnpm agent
```

Open `http://localhost:3000`, select Agent run, then Run live agent. The companion listens only on
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

The public site has no live provider endpoint. It replays the reviewed original proposals in
`apps/web/public/data/agent-session.json`, anchored by the reviewed hash in `agent-recording.ts`.
Source/configuration binding and self-hash validation precede independent verification. Replay
uses `aiMode: replay`; local fresh responses use `aiMode: live`. Both rerun the same engine.

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

Run the local live workflow once before recording to check login/access; do not keep retrying to
manufacture a preferred model result. For a reliable take, use the published recorded-agent mode
and explicitly say it is a recording with fresh verification. For a live take, show the actual live
button and call, and narrate whatever the model really returns. Cuts through waiting time must be
labelled. The script's observed numbers describe the reviewed September 5 run, not guaranteed live output.
