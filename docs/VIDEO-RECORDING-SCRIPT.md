# Vouch — five-minute submission video

Updated September 5 after the integrated live-agent run. Target 4:45–4:58 after rehearsal.
Face: first 20–25 seconds and last 20 seconds. Product: full screen in between, with clear voice
and captions. Actions below are not spoken. No loud music or invented progress screens.

## Before recording

Open Vouch on **Agent run**. Check **Replay recorded agent + reverify** once. It should show
9 → 10 proved, 41.7% coverage, 25 exception records, 1,083/1,083 rows, and two proposals: one verified,
one rejected. Check Proof Lab once, then reload for a clean take. Close unrelated tabs/notifications.
This script uses an honestly labelled recorded model response plus fresh verification. For a fresh
live take use the alternate passage below. Time your own voice and clicks; these timings are targets.
If slow, omit the optional tax sentence and shorten pauses—not the limitations.

## 0:00–0:25 — Face: the problem

> I'm Vinay, and this is Vouch, for Track Four: AI Finance Controller.
>
> Imagine your payout reference matches—but five thousand rupees are missing.
> Or the bank amount is correct, but your own books are incomplete.
>
> A green match can hide two very different problems. Vouch checks the evidence before it closes a case.

## 0:25–0:55 — Screen: show the agent

Show the four stages. Click **Replay recorded agent + reverify**.

> Vouch compares three sources: Razorpay reconciliation, the bank statement, and the merchant ledger.
> This synthetic batch has 1,083 source records covering 24 settlements.
>
> The workflow reconciles first, asks AI to investigate unresolved evidence, checks every proposal,
> and produces a proof report with the exceptions it cannot resolve.
>
> For this demo, I'm replaying a recorded model response. Verification is running again from the raw sources.

## 0:55–2:00 — Screen: AI earns one match and loses another

Show 9 → 10, then the two proposal cards. Point to the quoted narration and PASS/FAIL checks.

> Deterministic rules prove nine settlements. The investigator receives only three unresolved bank
> entries and four possible settlements—not an instruction to make everything green.
>
> It returns two proposals. Here, the bank narration splits a payout reference with spaces and slashes.
> AI identifies the candidate and cites the exact text.
>
> The program checks the citation, reference, amount, currency, posting date and merchant evidence.
> It also checks the whole matching graph, so a plausible candidate cannot steal another settlement's credit.
>
> This proposal passes and adds one proved settlement.
>
> The second proposal looks plausible too, but fails the posting-window check. It stays rejected.
> The model's confidence cannot overrule a failed test.
>
> That is the boundary: AI helps interpret evidence. Code decides whether the evidence is sufficient.

Optional if time allows: open Run provenance. Say “The original model call took about twenty
seconds.” That number is the recorded call latency, not replay execution time.

## 2:00–3:15 — Screen: challenge the proof

Open **Proof Lab**, click **Reconcile sample sources**. Keep default `setl_950hhkn23ad9sd`.
Choose **₹5,000 goes missing**, then **Change source & rerun**. Next choose **The books lose a row**
and rerun. Finally choose **Restore the source** and rerun.

> Now let's challenge a proved case. AI is off in this lab.
>
> This settlement expects fifty-nine thousand, five hundred and sixty-seven rupees and sixty-eight paise.
> The bank and the required merchant records agree.
>
> I reduce the source bank credit by five thousand rupees, keeping the reference unchanged.
> Vouch recalculates and withdraws the proof. This is a controlled test—not money I claim to have recovered.
>
> Next, the original bank amount is back, but a required merchant record is missing.
> The bank agrees. The books do not. The overall case remains open.
>
> Restoring the source reproduces the original proof. We changed inputs, not verdicts.
>
> Money is integer paise, with no tolerance. Tax already included in a fee is not subtracted twice.

## 3:15–4:15 — Screen: close the loop and report honest numbers

Return to **Agent run**; its session is retained. Show the summary, exception register and exports.
Click **Export exceptions CSV** once.

> The recorded run proves ten of twenty-four settlements: a 41.7 percent match rate.
> Fourteen remain unproved. All 1,083 rows are accounted for, and every accepted match closes
> at exactly zero residual.
>
> There are twenty-five exception records. That is not twenty-five settlements: a case can have
> multiple issues. Each exception includes evidence and a suggested next action.
>
> I can export the proof, the agent trace and this review queue. The reconciliation run is complete;
> unresolved financial cases are not silently marked complete.
>
> Our separate development benchmark found ten correct automatic verifications out of ten attempts.
> This is a small synthetic test, not production accuracy. Zero observed false matches is not a
> promise of zero future risk, and exception classification is still imperfect.

## 4:15–4:40 — Screen: engineering and limits

Show Proof Lab's file inputs briefly, then the public repository README.

> Users can also reconcile their own three files using the documented schema. That flow stays
> in the browser and does not call AI.
>
> The repository includes the agent, engine, tests, evaluation and limitations.
> I used AI extensively to build this prototype. My responsibility is understanding and defending
> its decisions—not claiming I wrote every line unaided.
>
> Vouch verifies supplied evidence. It does not authenticate bank statements or move money.

## 4:40–4:58 — Face: close

> My next step is testing with anonymized real merchant data and finance users.
>
> I want to build finance automation that earns trust through evidence, including when the answer is no.
>
> AI proposes. Code verifies. Every unresolved case stays visible.
>
> I'm Vinay. This is Vouch.

## Alternate: actual local live take

Use the setup in [AGENT-WORKFLOW.md](AGENT-WORKFLOW.md). Replace the recorded-mode sentence with:

> I'm starting a live investigation through my local Codex connection. The agent sends only the
> bounded public synthetic evidence. After the model responds, code independently checks its proposals.

Show the actual **Run live agent** click. Explain the stages during the wait, or label any cut
“model wait shortened.” Describe the result actually returned. Do not splice recorded proposals
into a purported live run. If fewer proposals are returned, say so and use the separately labelled
recording for the two-case comparison. If live fails, switch openly to replay. Do not repeatedly
rerun the model to manufacture a preferred result.

## Claims to avoid

- Not “100% accurate,” “unique in India,” “guaranteed to win,” or “production-ready.”
- Not “all exceptions resolved,” “money recovered,” or “authenticated bank proof.”
- Not “live AI” for public replay or the older sealed demo.
- Not “provider-confirmed model” when only the requested model is recorded.
- Not “free inference” when cost was not reported, or core throughput as end-to-end AI speed.
- The trace shows program events, cited evidence and checks—not hidden model reasoning.
