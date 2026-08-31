# Authentic AI capture

The judging path stays offline: `pnpm demo` reads the committed replay cache and makes no network
or subscription call. Live capture is a separate, explicit development command used to prove that
a real model can produce the same untrusted hypothesis shape.

## Capture with an authenticated CLI

Codex CLI is the default capture adapter for the OpenAI model provider. It runs in a new temporary directory that contains only the
output schema, receives only the synthetic public investigation packet, uses a read-only sandbox,
ignores user configuration and rules, and does not persist the session:

```bash
pnpm capture:ai --provider codex-cli --model gpt-5.6-sol \
  --output artifacts/ai-capture.json
```

Claude CLI is also supported. It disables tools, customizations and session persistence, and adds
a hard API budget when that CLI uses billable API access:

```bash
pnpm capture:ai --provider claude-cli --model claude-fable-5 \
  --max-budget-usd 0.50 --output artifacts/ai-capture.json
```

## Direct HTTP providers

The provider-neutral adapter can call Anthropic Messages or OpenAI Responses directly. Secrets are
read only from the environment and are never placed in the request hash or capture file.

```bash
# ANTHROPIC_API_KEY is present only in the shell/.env.local
pnpm capture:ai --provider anthropic --model claude-fable-5

# OPENAI_API_KEY is present only in the shell/.env.local
pnpm capture:ai --provider openai --model gpt-5
```

The Anthropic adapter uses `POST /v1/messages` with `output_config.format` JSON Schema. The OpenAI
adapter uses `POST /v1/responses`, Structured Outputs, and `store: false`. These shapes follow the
[Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create),
[Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
and [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses/create).

## What the envelope proves

`artifacts/ai-capture.json` records:

- the exact prompt version, supplied instructions, public investigation data and output schema;
- component and combined public-input SHA-256 hashes plus a canonical request SHA-256;
- the invocation adapter separately from the model provider, plus requested/reported model, client version and response identifier;
- start/end timestamps, latency, token usage and provider-reported cost when available;
- the raw provider response, parsed structured response and canonical SHA-256 for each layer;
- every deterministic hypothesis verdict, its hash and the resulting run summary; and
- a self-hashed capture payload plus a hash-bound `replay_candidate` that is inert until a human explicitly reviews and promotes it.

The model cannot mark a settlement reconciled. Its response enters the same strict schema checks,
literal-span checks, exact amount/currency/date checks and global matching uniqueness analysis as a
replay response. A malformed, invented or unsupported hypothesis is recorded as rejected.

## Promotion rule

Never overwrite `data/fixtures/replay-cache.json` merely because capture succeeded. Review the
public evidence, raw response and verifier verdicts first. If deliberately promoted, append the
`replay_candidate` as one reviewed cache entry and rerun `pnpm check`, `pnpm demo`, and `pnpm eval`.
