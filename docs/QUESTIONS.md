# Panel Questions — practice answers

These are draft answers in Vinay's voice. They should be understood and rephrased naturally,
not memorised word-for-word.

## “What does Vouch do in one sentence?”

It proves whether Razorpay's settlement equation, the bank credit, and my own books describe the
same money—and if the evidence is not unique, it refuses to guess.

## “Where is the AI?”

The AI reads messy narration and proposes a small typed hypothesis such as “this literal span may
contain this settlement UTR.” It cannot mark anything reconciled. Code verifies the literal span,
the allowlisted transformation, exact amount, INR, date window, and global uniqueness before the
edge can be accepted.

## “Why not let an LLM reconcile the CSV directly?”

Because a plausible explanation is not accounting evidence. A model can hallucinate an ID, follow
an instruction hidden in narration, or make a tiny arithmetic mistake. Vouch uses the model only
where language is useful and keeps financial authority in deterministic checks.

## “Why is zero tolerance important?”

One paise is still an unexplained paise. Tolerance can make a wrong fee treatment or short credit
look reconciled. Vouch uses exact integer paise, and an automatic match must close at residual zero.

## “What is the fee-versus-tax trap?”

In the recon evidence used here, the fee already includes its tax component. Subtracting both fee
and tax again creates a believable but wrong settlement. We keep a golden test where only the
correct interpretation closes to zero.

## “How do you prevent greedy matching?”

Vouch builds a bipartite graph of supported settlement-to-bank edges. It computes a maximum
matching, then removes each candidate edge in turn. An edge is automatic only if removing it lowers
the maximum cardinality. If two complete assignments survive, the result is ambiguity.

## “Could the prompt-injection text in a bank narration control the system?”

No. Narration is quoted evidence, never an instruction channel. A model response must fit a closed
schema, cite a literal span, and pass independent tests. The planted hostile narration is rejected
and the case stays open.

## “What did AI actually improve?”

On this sealed synthetic development batch, deterministic evidence correctly automated 9 of 11
uniquely decidable cases. The verified replay hypothesis added one more, reaching 10 of 11, without
adding a false automatic decision. That is a measured one-case lift, not a universal accuracy
claim.

## “What are your headline results?”

For the hybrid run: 10 automatic verifications, 10 correct, 0 false; 10/11 unique-case recall;
3/3 ambiguity precision and recall; and exactly zero accepted residual paise. The batch has 1,083
physical input rows and every row receives a terminal outcome.

## “Is 0/10 enough to say it is safe?”

No. It is the observed result on a small synthetic development benchmark. We display the Wilson
upper bound and do not call it production accuracy. The stronger claim is architectural: unsafe
or non-unique evidence is designed to abstain instead of being made green by a model.

## “Why is exception precision not 100%?”

The benchmark scores strict planted exception instances. Vouch can emit a root cause and a valid
downstream consequence—for example duplicate evidence can also create a UTR conflict—while the
truth manifest may plant only one category. Hybrid currently scores 18/25 instance precision and
18/26 recall after the invalid-source quarantine correction. I report that honestly instead of
hiding the taxonomy mismatch. See eval/RESULTS.md for the before/after explanation.

## “What happens with no API key or an outage?”

The committed demo uses a response replay keyed to the exact public-input hash, so judges need no
API key. If the replay is missing or invalid, Vouch warns and continues with deterministic
evidence. It never converts an outage into a guessed match.

## “What would you build next?”

First I would freeze and run a genuinely held-out corpus, expand bank-format adapters behind the
same typed boundary, and refine exception taxonomy without weakening automatic-match rules. Then I
would test with consented merchant exports and measure review-time reduction separately from match
accuracy.

## “What did you personally learn?”

I learned that the strongest AI product is not always the one giving AI the final answer. Here the
valuable design is a narrow AI role surrounded by evidence, exact arithmetic, abstention, and an
audit trail. I can explain and run the full path even though AI tools accelerated the build.
