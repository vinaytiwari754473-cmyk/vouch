# Vouch — final recording guide and five-minute script

Updated September 5 after successful local Gemini HTTP integration. Target 4:50–4:55; stay under
five minutes rather than assuming an overrun will be accepted. Timings are rehearsal targets,
not a guarantee. Speak only the blockquotes in the main script.

## Verified submission requirements

The [official Buildathon page](https://razorpay.com/buildathon/) requests a public repository,
a five-minute pitch video and architecture. Track 4 asks for a completed finance-ops loop over
50+ synthetic records, match rate, throughput, measured accuracy and unresolved exceptions.

The [official linked application form](https://docs.google.com/forms/d/e/1FAIpQLScJ9XSqVCB2oaPwEMH0Zk3I1OpILFW1WpWdWweQ2950jdRzlg/viewform?usp=send_form)
separately requires **Build Challenges & Technical Obstacles**, asking what issues arose and how
they were solved. The current page/form does not use the phrase “what broke at 2am,” and does not
explicitly require the challenge inside the video. Include the short story below in the video;
paste the fuller answer from [BUILD-CHALLENGE.md](BUILD-CHALLENGE.md) into the required written field.
Do not invent a literal 2 a.m. timestamp or claim unaided development.

## Important release status

The Gemini integration has passed real local API and HTTP tests and is included in this repository
update. Deployment to the public website remains pending; do not call the public site updated yet.
Record the new flow locally, or use the public URL only after its Gemini release is deployed and
verified. Publishing the product does not submit the application.

For local recording, run `pnpm dev` from `C:/Users/vinay/TALLY` and open `http://localhost:3000`.
The ignored local server-secret file and local usage database were configured during integration.
Enter the separate demo access code before recording; never enter or show the Gemini API key.
The code is in the ignored `artifacts/local-agent/gemini-access-code.txt` file. Keep that file off camera.

## Recorder and three-part format

Use [OBS Studio](https://obsproject.com/) for recording. Run Tools → Auto-Configuration Wizard and
choose recording. Set video to 1920×1080, 30 FPS. Use Window Capture for one browser window and
Video Capture Device for the webcam. Select the intended microphone; mute desktop audio unless
needed. Record a 20-second test, play it back and check speech and readable numbers before a full take.
See [OBS quick start](https://obsproject.com/kb/quick-start-guide).

Record three clips: face intro; full-screen product with your voice; face outro. A continuous face
bubble is not necessary and can obscure evidence. Keep the same microphone and room for all clips.
Record to MKV, then use File → Remux Recordings to get MP4. OBS recommends MKV because an interrupted
recording is less likely to lose the whole file: [recording guide](https://obsproject.com/kb/standard-recording-output-guide).

Use Clipchamp only to join clips, trim pauses and correct captions. Its personal free tier supports
1080p exports with your own media: [Microsoft guidance](https://support.microsoft.com/en-us/clipchamp/what-clipchamp-products-are-there-and-what-s-their-cost).
Avoid premium assets, elaborate transitions and background music. Correct captions for Vouch,
Razorpay, Gemini, paise, 1,083, 24 and 41.7%. Export 1080p MP4.

## Prepare the browser

Keep these tabs in the same captured browser window:

1. Vouch, starting on **Agent run**. Enter the demo code privately, check availability and remaining calls.
2. [Committed evaluation results](https://github.com/vinaytiwari754473-cmyk/vouch/blob/main/eval/RESULTS.md).
3. [Correctness regression tests](https://github.com/vinaytiwari754473-cmyk/vouch/blob/8f6e3834e95fe05c6cad5cbad47e9ced77eee1c2/packages/core/src/core.test.ts#L169).

Use a readable browser zoom; close unrelated tabs, notifications, account menus and downloads.
Keep the script on paper or another device, never over the recorded product. Do not show secret
files, private chat history or the demo code. Verify the recording captures the intended window.

The latest local HTTP run returned two proposals (one verified, one rejected), 10/24 proved
settlements, 25 exceptions, 1,083/1,083 rows, zero accepted residual and 12.2 seconds model latency.
These are observations, not guaranteed future output. The narration below assumes the same visible
result. If a fresh run differs, adjust the narration to the actual screen. Never rerun repeatedly
to manufacture a preferred answer. Label any edit through waiting time “model wait shortened.”

## Main script

### 0:00–0:20 — Face: the problem

Screen: your face, eye-level camera, plain background. Small caption: “Vinay | Vouch | Track 4”.

> I’m Vinay. This is Vouch, for Track Four: AI Finance Controller.
>
> A matching payout reference does not prove that the right amount arrived—or that the merchant
> recorded it correctly. Vouch checks all three before closing a case.

### 0:20–0:55 — Product: start the actual agent

Screen: Agent run. Show the four stages. Click **Run live Gemini agent** once, then let the real
progress run. Explain the workflow during the wait; do not show the code entry.

> This synthetic batch contains 1,083 source records across 24 settlements: Razorpay reconciliation,
> bank credits and merchant books.
>
> I’m starting a fresh Gemini investigation. The workflow reconciles first, sends only unresolved
> public evidence to the model, checks its proposals, and produces proofs plus an exception queue.
>
> The API key stays on the server. Gemini proposes relationships. Code calculates money and decides
> whether a settlement can be verified. The browser independently checks the result again.

### 0:55–1:40 — Product: one proposal passes; another fails

Screen: show 9 → 10 and the proposal cards. Locate **CANDIDATE VERIFIED** first, then **PROPOSAL
REJECTED**; card order can differ. Point to the literal citation and failed posting-window check.

> Rules alone prove nine settlements. Gemini investigates three unresolved bank entries and four
> candidate settlements.
>
> In this run, it returns two proposals. One identifies a payout reference split by spaces and
> slashes in the bank narration. It cites the exact text.
>
> Code checks that citation, the reference, amount, currency, posting date and merchant evidence.
> It also checks competing assignments across the whole batch.
>
> One proposal passes and adds a proved settlement. The other fails the posting-window check and
> stays rejected. Model confidence cannot override that failure.

### 1:40–2:35 — Product: change evidence, not verdicts

Screen actions:

1. Open **Proof Lab** → **Reconcile sample sources**.
2. Keep default settlement `setl_950hhkn23ad9sd`.
3. Select **₹5,000 goes missing** → **Change source & rerun**. Show the changed credit/residual/verdict.
4. Select **The books lose a row** → rerun. This starts from the original sources, with a ledger row removed.
5. Select **Restore the source** → rerun. Show **IDENTICAL BASELINE ARTIFACT ID**.

> Now I’ll challenge the proof. AI is off in this lab.
>
> First, I reduce the bank credit by five thousand rupees, leaving the payout reference unchanged.
> Vouch recalculates and withdraws the proof. A matching reference cannot explain missing money.
>
> Next, the original bank amount is back, but a required merchant record is missing. The cash
> agrees; the books do not. The overall case remains open.
>
> Restoring the original sources reproduces the same proof and artifact identifier.
>
> These are controlled synthetic tests—not recovered money. We changed the evidence, not a status
> label. Even a one-paise unexplained difference prevents automatic closure.

### 2:35–3:15 — Product: finish the loop with an honest handoff

Screen: return to **Agent run**, whose result is retained. Show the metrics, expand the exception
register, then click **Export exceptions CSV**. Do not open unrelated downloaded files.

> This run proves ten of twenty-four settlements: a 41.7 percent match rate. Fourteen remain
> unproved. That is coverage, not accuracy.
>
> All 1,083 rows are accounted for. Every accepted match has exactly zero residual.
>
> There are twenty-five exception records because one case can have multiple issues. Each includes
> evidence and a suggested next action. I can export the proof, agent trace and review queue.
>
> The reconciliation run is complete; unresolved financial cases are not silently closed.
> Vouch verifies supplied evidence. It does not authenticate bank statements or move money.

### 3:15–3:45 — Evidence: accuracy and throughput

Screen: switch to the pre-opened GitHub **eval/RESULTS.md** tab. Show the 7/9/10 comparison table,
then the local performance paragraph. This is separate development evaluation, not a Gemini live
score. Do not hunt for the UI Evaluation tab: it is hidden when the active result is not the sealed demo.

> The separate development benchmark verified ten automatic matches out of ten, with zero false
> automatic matches observed.
>
> It’s a small synthetic test, not production accuracy.
>
> The local reconciliation engine processed about fifteen thousand rows per second. That excludes
> the model call.
>
> The repository includes the architecture, tests and reproducible evaluation.

### 3:45–4:30 — Evidence: the real build challenge

Screen: switch to the test-code tab. Show **rejected source evidence cannot disappear from a
related proof**, the assertions for INVALID_INPUT / zero exact matches / complete row accounting,
then the test for an unrelated malformed record. Zoom so the selected block is readable.
Optional short caption: “Rejected evidence must still affect related decisions.”

> One dangerous bug wasn’t an AI hallucination. It was a misleading proof.
>
> An AI-assisted review exposed a case where a malformed row was flagged, but the remaining rows
> could still balance. The rejected row’s connection to the settlement had been lost.
>
> With Codex, I fixed that by retaining those connections and blocking the affected proof.
> Regression tests check both sides: related bad evidence blocks closure; unrelated bad evidence
> does not block a clean case.
>
> My lesson: accounting for every row is not enough. Every relevant row must affect the decision.

### 4:30–4:55 — Face: ownership and next step

Screen: your face again. End with a small Vouch / Track 4 caption, not a long animated outro.

> I used AI extensively to build Vouch. I’m responsible for understanding its decisions and its limits.
>
> Next: testing with finance users and consented merchant data.
>
> AI proposes. Code verifies. Unresolved cases stay visible.
>
> I’m Vinay. This is Vouch.

## If the live API fails during recording

Keep that fact honest. Say: “The live provider is unavailable. I’ll use the separately labelled
recording and rerun verification.” Click **Replay recorded agent + reverify**. The public recording
is from Codex, not Gemini: say “recorded investigator” instead of “Gemini” for those proposals.
Use “this recorded run” for the result. Never present replay as a successful fresh call.

## Last rehearsal and submission checks

- Say the script aloud and time the clicks. If over five minutes, shorten pauses and explanations;
  retain the match rate, exceptions, accuracy, throughput and limitations. Do not speed up speech artificially.
- Watch the exported MP4 fully. Check readable numbers, clear audio, synced captions and no secrets.
- Use an accessible video link; verify it logged out. Likewise check repository, architecture and product.
- Complete the separate written challenge field. The form includes a final-submission acknowledgement
  that responses cannot be changed after submission; review every link before that final action.
- Confirm the actual submission deadline with the organisers if needed: the current public page/form
  inspected for this guide does not state one. Do not rely on old assumed dates.
- Do not claim a literal 2 a.m. incident, production readiness, guaranteed safety, recovered money,
  a held-out result, public Gemini availability before publication, or guaranteed selection.
