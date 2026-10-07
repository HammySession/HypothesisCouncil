# Hypothesis Council Report

## Research goal

What is a limit of current LLMs that is not fixed by more scale, more data, or a longer context window, and what observation in the next two years would falsify that claim?

## Executive summary

16 hypotheses were generated; 16 remained after deterministic lexical deduplication. Explicit provider labels were hidden during review.

Consensus crowding: none detected; no cross-provider convergence above the similarity threshold.

> Rankings summarize model review signals. They are not calibrated scientific probabilities.

## Ranked hypotheses

### 1. H-008: Logit amnesia: LLMs lack an efference copy, so their own low-confidence tokens become unimpeachable evidence (out-of-the-box batch)

**Claim:** The binding limit is not knowledge, capacity, or circuit class but a missing self-monitoring channel. Because pretraining and supervised fine-tuning present every context token as ground truth, a model learns that whatever sits in its context is veridical, including tokens it emitted moments earlier at low confidence. Role tags tell it who spoke; nothing tells it how sure it was. The uncertainty that existed at emission time is never consulted again, so errors compound across a long generation at a rate set by per-token error and generation length rather than by fact rarity. More parameters sharpen per-token accuracy but leave the veridicality assumption intact, and a longer context window increases exposure to the model's own text and therefore worsens the problem rather than fixing it.

**Mechanism:** In motor neuroscience an efference copy of the motor command lets an organism discount sensory input it caused itself, which is why you cannot tickle yourself. A transformer has no learned equivalent. An emitted token re-enters through the same input pathway as a user token, and although the hidden state that produced the uncertain distribution still sits in the key-value cache, teacher-forced training never contains sequences with the model's own low-probability choices, so no gradient ever teaches the model to attend back to that state, hedge, or revise. The result is a system that confabulates and then builds on the confabulation with full fluency. Training that samples the model's own rollouts and scores the outcome does supply such a signal, which is why the fix is a change of training signal, not scale.

**Predictions:** In a teacher-forced model family at three or more parameter scales, downstream hedging, revision, or self-correction referencing a span is no more frequent after a naturally emitted token with top-1 probability below 0.4 than after one above 0.9, and the gap does not grow with scale.; Replacing a high-confidence emitted token with its runner-up and continuing decoding yields a continuation that builds on the forced error with the same fluency and factual error rate as continuations after low-confidence tokens: the model does not notice its own forced error at any scale.; Holding entity frequency fixed, the per-claim hallucination rate in long free-form answers rises with the position of the claim in the generation; the calibration account predicts a position-independent rate.; For the same model, removing its own earlier turns and re-asking cold reduces cumulative factual error more than supplying additional turns of its own text, so extending context filled with self-generated output lowers accuracy.; A model's stated confidence in a claim it produced three turns earlier exceeds its confidence in the identical claim asked cold, and the inflation does not shrink with scale.; Models post-trained with reinforcement learning on their own sampled rollouts show backtracking rates that correlate with the entropy of their preceding tokens, while matched base and supervised checkpoints of the same family show no such correlation.

**Differs from consensus:** The context's dominant account (S-002, S-015) locates hallucination in the statistics of rare facts under a calibrated pretraining objective, which implies a position-independent per-claim error rate and that more context, as more evidence, helps. This hypothesis predicts the opposite on three observables: error rate rises with generation position when rarity is held fixed; context windows filled with the model's own output lower accuracy; and a model treats its own 0.3-probability token exactly like a 0.95-probability token downstream, at every scale. It also contradicts the expressivity accounts (S-001, S-011): the problem is not what the circuit can compute but which of its own internal states training taught it to ignore, so a non-TC0-capable architecture would inherit the same flaw.

**Evidence basis:** 3 verified source · 2 general knowledge · 1 speculation

**Minimal discriminating experiment:** Take an open model family with at least three sizes and shared training recipe (base or supervised checkpoints). Generate 1,000 long biographies of mid-frequency entities with greedy decoding while logging per-token top-1 probability. Tag spans where the emitted token had p < 0.4 (condition L) and spans with p > 0.9 (condition H). Score the continuation after each span for hedging, revision, or contradiction referencing it, and for factual error against a knowledge base, using a frozen judge. Add a swap arm: replace an H-token with its runner-up and continue, measuring whether the continuation builds on the forced error. Also bin every factual claim by generation position and by entity frequency and fit error rate against position. Then repeat on the same family's reinforcement-learned variant and test whether backtracking correlates with preceding-token entropy. The hypothesis predicts no L versus H difference, no scale trend, error rising with position, and entropy sensitivity only in the reinforcement-learned variant. Two weeks of compute on 1B to 70B open checkpoints suffices.

**Declared falsifier:** On a matched battery of 1,000 long-form factual answers from one open model family at three or more parameter scales, all trained without reinforcement learning on their own rollouts, the rate of downstream hedging or revision referencing a span is significantly higher after naturally emitted tokens with top-1 probability below 0.4 than after tokens above 0.9, and that gap grows monotonically with scale; equivalently, a frontier long-context model shows a per-claim hallucination rate flat across generation position once entity frequency is controlled. Either observation, published and replicated by October 2028, refutes the claim. (graded concrete by review)

**Review signal:** 8.31 / 10 · novelty 8/10

**Strongest objection:** The claim attributes compounding error to a missing structural channel ('efference copy'), yet concedes that emission-time uncertainty remains encoded in the key-value cache and can be leveraged after rollout-based RL. If weight updates alone enable the model to attend to this uncertainty without architectural modification, the limitation is not an architectural absence of self-monitoring, but an optimization deficit of teacher forcing. Furthermore, increasing hallucination rates across generation length can easily be confounded by cumulative Bernoulli trial failure and attention dispersion over long contexts rather than logit amnesia specifically.

**Adversarial competing explanation:** Long-form error growth is conjunction under ordinary autoregressive conditioning. A calibrated next-token model assigns falling probability to a fully correct biography as dependent claims accumulate, because each later sentence conditions on earlier generated text; the joint failure rises with length while one-step error given a true prefix stays flat. The same coherence that adopts a user-written false premise adopts a forced runner-up and then continues fluently. Exposure bias pushes free-running prefixes off the teacher-forced manifold and compounds prefix mistakes with length. Stated confidence rises for any claim that already sits in context as an assertion, including the identical sentence pasted as a user turn. Rollout reinforcement learning reduces the rate by penalizing unverified continuations. The pattern is fully explained by discarded decode-time probabilities plus premise-taking, which is the same phenomenon the calibration and exposure-bias accounts already describe.

**Unresolved fatal flaw:** None recorded

---

### 2. H-006: Hindsight-selected corpora: text is written after outcomes are known, so LLMs inherit an outcome-biased prior that more text cannot remove

**Claim:** The documents LLMs learn from were mostly written after the events they explain were resolved, so the reasoning they contain is selected on outcome. The model learns a hindsight-shaped distribution over explanations that is coherent, confident, and tilted toward the paths later validated. This produces overconfident prospective judgement that more parameters, more text, or longer context cannot fix, because each delivers more outcome-selected narrative; only changing which documents are learned from can.

**Mechanism:** Decision science documents hindsight and outcome bias in people; here the bias sits in the data-generating process. Explanations are written once outcomes are known, counterfactual paths that did not occur are rarely written up, and pre-outcome forecasts are scarce, revised, or deleted. The corpus therefore estimates P(reasoning | outcome known) rather than P(outcome | evidence available before the fact). A model sampling from that distribution treats every situation as already resolved: it allocates probability as if the deciding evidence were present, so stated probabilities are too extreme and explanations retrofit the outcome. Scale fits this distribution more faithfully, so the bias grows or holds rather than shrinking.

**Predictions:** On prospectively registered questions resolved after the model's cutoff, with an identical frozen pre-resolution document packet supplied, frontier models show a calibration slope below 1 (overconfidence) that does not improve across three consecutive generations.; Retrodiction quality (explaining already-resolved events) improves with scale while prospective Brier scores plateau, so the retrodiction-prediction gap widens with each generation.; A smaller model continued-pretrained only on documents dated before each item's outcome shows better prospective calibration than a larger model trained on the standard corpus.; Shown only pre-outcome documents, models rate resolved outcomes as more foreseeable than contemporaneous human forecasters rated them at the time, the signature of hindsight bias.

**Differs from consensus:** The standard explanations of LLM forecasting weakness are stale knowledge, fixed by retrieval and a longer context window, or insufficient reasoning, fixed by scale; the causal-hierarchy account locates the limit in observational versus interventional data. This hypothesis predicts overconfidence that survives perfect up-to-date context, persists or grows with scale, and is removed only by a data-selection intervention (time-sliced, pre-outcome text) rather than a data-volume one. The observable difference is a smaller time-sliced model out-calibrating a larger standard model on the same frozen packets.

**Evidence basis:** 1 verified source · 1 general knowledge · 2 speculation

**Minimal discriminating experiment:** Assemble 500 forecasting questions that resolve after the cutoffs of three model generations and freeze one identical pre-resolution document packet per question. Elicit probabilities from each generation and from a control model continued-pretrained only on time-sliced documents dated before each item's outcome. Compare calibration slopes and Brier scores. Add a hindsight probe: from pre-outcome documents only, ask each model how predictable the resolved outcome was and compare with the archived contemporaneous human forecast.

**Declared falsifier:** By October 2028, a frontier model trained on a standard corpus, given only frozen pre-resolution context, reaches a calibration slope within 0.05 of 1.0 and a Brier score at or below the superforecaster aggregate on at least 500 prospectively registered questions resolved after its training cutoff. (graded concrete by review)

**Review signal:** 7.38 / 10 · novelty 8/10

**Strongest objection:** Calibration is a property of the output probability mapping that can often be adjusted via lightweight post-training interventions (e.g., calibration fine-tuning, RL with proper scoring rules, or Platt/temperature scaling) without altering the pretraining corpus. If post-training or elicitation techniques can correct overconfidence on prospective forecasting tasks, the pretraining hindsight distribution is not an insurmountable structural limit.

**Adversarial competing explanation:** Elicitation and alignment mode collapse: Autoregressive decoding and RLHF reward functions strongly penalize epistemic ambivalence and dispersed probabilities in favor of decisive, authoritative, and linguistically coherent single-trajectory narratives. The apparent hindsight bias is not an immutable property inherited from corpus time-stamps, but an artifact of greedy generation and human-feedback optimization favoring overconfident rhetoric, which resolves when probabilities are elicited through test-time search, multi-agent debate, or proper scoring rule optimization.

**Unresolved fatal flaw:** None recorded

---

### 3. H-014: Do-query accuracy tracks interventional narration density

**Claim:** The limit that more parameters, more associational text, and a longer context window do not remove is a shortage of faithful reports of interventions that were actually performed. A text-only model agrees with a do-calculus oracle on queries that have no observational equivalent in the underlying graph when, and only when, its training measure contains those reports at sufficient density. A token-matched rewrite of the same corpus into purely associational prose, at the same parameter count and the same context length, leaves oracle agreement near the observational baseline. Scaling width or associational token count in the rewritten corpus does not close that gap.

**Mechanism:** An interventional query needs variation that cuts the relevant edges. A sentence reporting a performed intervention, together with the outcome that followed, is a noisy sample from the interventional conditional. A sentence that only co-occurs the same variables is a sample from an observational conditional. Next-token training fits whichever conditional is present in the text. When the query is chosen so that no functional of the observational conditional equals the interventional answer, no volume of associational text identifies it, and neither a larger network nor a longer window at answer time invents the missing samples. Narration density is a property of what the corpus records, not of parameter count or window length. Hidden-state probes can still correlate with the latent variable from observational co-occurrence, which is why probe accuracy can look causal while answers stay observational.

**Predictions:** From-scratch transformers matched within 10 percent in parameter count and matched in context length differ by at least 25 percentage points of do-oracle agreement when at least 5 percent of training documents are faithful intervention transcripts, versus a token-matched associational paraphrase of those documents.; Multiplying associational tokens by ten, or width by four, on the paraphrase arm does not close that gap to within 10 points.; On the paraphrase arm a linear probe of the hidden state can recover the intervened variable well above chance while behavioral oracle agreement stays within 10 points of the best observational predictor.; The transcript-arm gain survives scrubbing any span that states the evaluation answer and survives using intervention values absent from training.; If the same transcript tokens are placed only in the answer-time context of a model trained on the paraphrase corpus, agreement rises for queries whose identifying report is inside the window and stays at the paraphrase-arm level for queries whose report is absent, at matched window length.

**Differs from consensus:** The standard application of the causal hierarchy says association, intervention, and counterfactual reasoning are strictly nested, so an interventional query with no observational equivalent stays unanswered by any amount of additional text, any parameter count, or any context length, because text is treated as purely associational. This hypothesis predicts that a text-only model matches the do-oracle once faithful interventional narration crosses a density threshold, at fixed parameters and fixed context, and that a token-matched associational rewrite of those same documents does not match it. That contrast is the observation that settles the disagreement.

**Evidence basis:** 4 verified source · 1 speculation

**Minimal discriminating experiment:** Publish a small known causal graph and a query list certified to have no observational reduction. Generate two equal-token corpora: transcripts of random performed interventions with outcomes drawn from the interventional distribution, and an associational rewrite that keeps observational conditionals but drops intervention markers and interventional outcomes. Scrub evaluation answer strings. Train two equal-size transformers from scratch, then ablate the rewrite arm with tenfold associational tokens and with fourfold width. Score oracle agreement on held-out intervention values, and separately report probe AUC for the intervened variable on each arm. A context-only control appends transcripts at answer time to the paraphrase-trained model without further training.

**Declared falsifier:** Before October 2028, on a preregistered query set that a do-calculus oracle answers and that has no observational equivalent in the stated graph, with answer spans scrubbed and test intervention values unseen in training, a from-scratch text-only model trained with at least 5 percent faithful intervention transcripts fails to exceed a token-matched associational paraphrase arm by at least 15 percentage points of oracle agreement, at matched parameter count and matched context length. (graded concrete by review)

**Review signal:** 7.17 / 10 · novelty 5/10

**Strongest objection:** The predicted gap follows almost by construction rather than against consensus. Assumption 5 makes the 'paraphrase' arm a resample from the observational distribution, not a rewrite of the same documents, so the experiment compares interventional samples against observational samples and the causal hierarchy itself predicts the winner. Pearl's result is about data provenance, not modality; it never claimed text cannot carry interventional samples, so the 'differsFromConsensus' framing attacks a position the cited source does not hold. The part that matters for the research goal, that the limit of current LLMs is narration density, is not tested at all: no density measurement on a real corpus, and no check that frontier models fail do-queries because of missing reports rather than because they cannot disambiguate report provenance or because they instead answer by explicit symbolic reasoning over a stated graph, which from-scratch small transformers cannot do.

**Adversarial competing explanation:** Where a transcript-versus-paraphrase gap is observed, it is explained by two things that have nothing to do with an LLM-specific limit. First, the result is estimator-agnostic: any conditional estimator handed samples from P(Y|do(x)) will track the oracle and any estimator denied them will not, so the experiment restates the identification theorem about datasets rather than exposing a property of language models. Second, the residual gap is query-format shift: the paraphrase arm has never seen do-syntax, so its deficit relative to the best observational predictor reflects out-of-distribution prompts, not missing interventional knowledge, and a handful of in-context format demonstrations with no interventional content would recover it. A further alternative is that the transcript arm wins not by fitting the interventional conditional but by learning an exogeneity flag from agentive narration that unlocks adjustment over structure it already learned observationally, which would mean sham interventions with observational outcomes produce most of the gain.

**Unresolved fatal flaw:** None recorded

---

### 4. H-011: Knowing a world does not imply knowing which experiment to run

**Claim:** A candidate limit is a persistent gap between predicting outcomes and selecting informative actions. My forecast is that, through 2028-10-06, scaling under an unchanged predictive and answer-reward training recipe will produce models that answer at least 95% of supplied-intervention questions correctly yet choose experiments at least 10 percentage points less successfully than an exact planner under the same two-action budget. The missing capability is reliable optimization for information acquisition, not necessarily a missing world model.

**Mechanism:** Passive prediction learns what usually happens under observed actions. Experiment selection must value an action for how its possible outcomes change future decisions, including outcomes that overturn the preferred hypothesis. These are different optimization targets. The conjecture is that LLMs can represent the relevant causal alternatives while their action policy favors plausible, confirming, or immediately useful actions over sequences that resolve uncertainty. More passive context can strengthen the preferred explanation without improving this policy.

**Predictions:** Models will accurately predict the outcomes of candidate interventions when asked individually but fail to select the sequence that best distinguishes the candidate worlds.; Failures will concentrate on problems where the best first experiment has little immediate information value but enables a decisive second experiment.; Outcome-based training that rewards successful identification will improve experiment choice more than an equal-token corpus of static experiment descriptions, while leaving supplied-intervention answer accuracy similar.

**Differs from consensus:** Against the explanation that weak scientific experimentation primarily reflects absent causal understanding, this predicts demonstrably accurate causal predictions alongside poor experiment selection. The observation separating them is successful prediction of each intervention's consequences followed by selection of an inferior intervention sequence.

**Evidence basis:** 2 verified source · 1 speculation

**Minimal discriminating experiment:** Construct 500 small synthetic causal-discovery episodes with four to eight candidate worlds and a two-intervention budget. Compute optimal adaptive policies exactly. Separately test outcome prediction, experiment choice, and interpretation of returned observations. Compare the model's chosen policy with oracle-chosen interventions fed to the same model, localizing any deficit to selection. If accurate outcome prediction and a selection gap do not coexist, reject the mechanism. Otherwise compare controlled scaling checkpoints and equal-token static-demonstration versus outcome-reward training arms.

**Declared falsifier:** By 2028-10-06, a scaling-only successor retains at least 95% supplied-intervention prediction accuracy and comes within 2 percentage points of the exact planner's final identification rate in every preregistered task family, including delayed-value experiments, with 95% confidence upper bounds on the gaps below 2 points. The result must replicate on newly sampled causal generators without an external experiment planner or a changed training objective. (graded concrete by review)

**Review signal:** 7.16 / 10 · novelty 7/10

**Strongest objection:** With four to eight stated worlds, listed actions, and a two-action budget, 95% intervention-prediction accuracy already supplies the quantities an exact planner uses. Optimal selection is then shallow tree enumeration, so matched test-time deliberation or a longer reasoning trace can close the gap under the same predictive recipe. The limit may therefore be fixed by inference compute and context. Gaps between 2 and 10 points also refute the stated forecast without meeting the written killing observation.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** None recorded

---

### 5. H-013: Prefix teacher-forcing starves compositional features as data grow

**Claim:** The limit that more parameters, more tokens, and a longer context do not remove is teacher-forced loss on prefix tokens in compositional and lookahead sequences. On average-case large-domain composition and star-graph path tasks, fixed-depth log-precision transformers already represent the iid solution, but next-token loss on prefixes lets a shared shortcut feature consume the gradient. Shortcut-conflicting accuracy under teacher forcing stays near the shortcut baseline, and falls or stalls as the number of distinct training problems grows, while in-distribution next-token loss keeps improving. The same depth, width, precision, token budget, and context length, trained with loss only on the final answer and with no added decoded steps, lifts shortcut-conflicting accuracy by a large margin. This does not claim a one-layer network can realize worst-case large-domain composition, and it does not claim a log-precision constant-depth network decides every context-free language.

**Mechanism:** Gradient starvation: when several features can reduce loss, the feature with the larger early gradient is amplified and the others stall. On these sequences the shortcut (copy a nearby symbol, continue a frequent local pattern) is shared across prompts, so its correlation is estimated more sharply as the number of problems grows and its gradient share increases. The compositional feature is idiosyncratic to the instance, so its gradient shrinks as the shortcut locks in. Extra width gives the shortcut more capacity. Extra context adds more prefix tokens that the shortcut fits. Dropping prefix supervision removes the easy targets that feed starvation, so the same optimizer can fit the deferred answer. Added chain-of-thought tokens under continued teacher forcing create new prefixes on which the same starvation operates, so serial tokens are a weaker intervention than changing which tokens carry loss.

**Predictions:** At fixed depth, width, and precision, teacher-forced training on star-graph paths and on iid composition with domain size at least 64 shows shortcut-consistent accuracy rising across a 100-fold increase in distinct problems while shortcut-conflicting accuracy rises by less than 10 points and stays within 10 points of the best local shortcut rule.; Outcome-only training, predicting the final answer with no gold prefix and no scratchpad, on the same architectures and the same problems, reaches shortcut-conflicting accuracy at least 20 points above the matched teacher-forced run at the largest problem count.; A fourfold width increase, a tenfold increase in teacher-forced tokens, or a longer prompt packed with additional problem text, each applied to the teacher-forced run, yields a smaller shortcut-conflicting gain than the outcome-only comparison.; Adding a logarithmic number of chain-of-thought tokens while keeping teacher forcing produces a smaller shortcut-conflicting gain than outcome-only training on the composition suite.; The outcome-only model still fails an adversarial slice built to saturate the one-layer communication bound, so success on the iid slice leaves that worst-case expressivity statement standing.; The iid gap appears in raw accuracy and in token log-loss, not only after a nonlinear threshold, so a metric-artifact account does not absorb it.

**Differs from consensus:** The dominant limit explanation in this literature is circuit class: log-precision fixed-depth one-pass transformers sit in a weak parallel class, and a single layer cannot compose functions once domains are large, so these families stay unsolved under any width, data volume, or context length until serial steps are added by depth or chain of thought. That account predicts a flat failure across objectives at fixed serial depth. The smooth-scale account predicts teacher-forced shortcut-conflicting accuracy rises with data and width until the gap closes. This hypothesis predicts a different interaction: at the teacher-forced failure point, removing prefix loss with zero added serial steps raises shortcut-conflicting accuracy by at least 20 points, and that gain exceeds the gain from logarithmic chain-of-thought under continued teacher forcing. The observation that settles it is which of those two interventions wins on the preregistered conflicting split.

**Evidence basis:** 4 verified source · 1 general knowledge · 1 speculation

**Minimal discriminating experiment:** Fix one log-precision transformer depth and width that has already failed under teacher forcing. Build star-graph and large-domain composition sets, and precommit a shortcut rule plus a conflicting split. Train three matched runs on the same problems: A teacher-forces every prefix token left to right; B applies loss only to the final answer predicted from the prompt with no gold prefix and no scratchpad; C teacher-forces a scratchpad of length c log n and then the answer. Sweep distinct-problem count over a 100-fold range for A and B. Report shortcut-consistent accuracy, shortcut-conflicting accuracy, and next-token loss, plus one adversarial slice aimed at the one-layer communication bound. Keep the hypothesis only if, at the largest count, B beats A by at least 20 conflicting-accuracy points on both iid suites and B's gain exceeds C's on composition.

**Declared falsifier:** Before October 2028, on a preregistered shortcut-conflicting split of iid large-domain composition (domain size at least 64) and of star-graph endpoint prediction, with depth, width, precision, distinct-problem count, and context length matched at a documented teacher-forced failure point, the accuracy gain from outcome-only training with no added decoded steps over teacher forcing is under 15 percentage points, or is smaller than the gain from adding O(log n) chain-of-thought tokens under continued teacher forcing. (graded concrete by review)

**Review signal:** 7.00 / 10 · novelty 7/10

**Strongest objection:** The verified star-graph evidence supports objective-dependent failure, but its teacherless multi-token intervention does not establish that final-answer-only supervision works or transfers to composition. The proposed mechanism also lacks support: estimating shortcut correlation more precisely does not itself increase its expected gradient, and instance-specific computations need not produce incoherent parameter gradients. An outcome-only improvement could reflect loss weighting or changed answer conditioning rather than gradient starvation. Finite scaling comparisons would establish a bounded failure regime, not immunity to all further scale.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** None recorded

---

### 6. H-005: Common-mode failure: self-verification is capped by generator-verifier error correlation that scale does not reduce

**Claim:** An LLM cannot drive its own error rate below a fixed fraction through self-checking, self-critique, or self-consistency, because the verifier reuses the representation that produced the error. The conditional probability that a model accepts its own wrong answer, P(accept | wrong), stays roughly constant across model generations; scale, data, and context grow generator and verifier together without decorrelating them.

**Mechanism:** Fault-tolerant engineering only gains from redundancy when the redundant channels fail independently; channels with a common cause fail together. A model asked 'is this answer correct?' computes that judgement from the same features and the same learned shortcuts that generated the answer, so whatever misled generation misleads verification in the same direction. Scaling raises both marginal accuracies but leaves the common cause intact, so P(accept | wrong) is set by representation sharing rather than by capability. A longer context only helps if it imports an independent signal, which by definition is no longer self-verification. Cross-family verification helps only partially, because different families share most of their training corpus and therefore share part of the common cause; a mechanical verifier is the only fully independent channel.

**Predictions:** At matched difficulty (items where the generator's own accuracy is 50 to 70 percent), P(accept | wrong) under self-verification stays within a narrow band across three consecutive frontier generations while marginal accuracy rises.; The detection gap between self-verification and verification by an equally capable model from a different family is the same size at every scale, and the cross-family gain is itself bounded by the fraction of training corpus the two families share.; Self-consistency and self-critique remove a saturating fraction of residual errors no matter how many samples are drawn, whereas a test suite or proof checker removes a fraction that keeps growing with sample budget.; Reinforcement learning on a model's own correctness judgements raises generation accuracy but leaves P(accept | wrong) unchanged or worse, because the policy learns to satisfy the shared failure mode.

**Differs from consensus:** The usual account of weak self-correction is that current models lack the reasoning capability to spot their own mistakes, so the next generation should catch more of them. This hypothesis predicts that P(accept | wrong) is scale-invariant and that only a verifier with an independent failure mode (a different model family, or a mechanical check) lowers it. The observable difference is a same-model versus cross-model detection gap that does not shrink as models improve.

**Evidence basis:** 2 verified context · 1 verified source · 1 general knowledge · 1 speculation

**Minimal discriminating experiment:** Take two equally capable models from different families and their smaller siblings. For each model, generate one solution per item on 1,000 ground-truthed problems. Have each model verify its own outputs and the other model's outputs with an identical prompt. Compute P(accept | wrong) for self versus cross verification at each scale. The hypothesis predicts a self-versus-cross gap of the same size at every scale; the capability account predicts the gap shrinks with scale.

**Declared falsifier:** By October 2028, a frontier model whose self-verification detection rate P(reject | wrong), measured with no tools on a difficulty-stratified held-out set of at least 1,000 ground-truthed math and code problems, comes within 5 percentage points of the detection rate achieved by an equally capable model from a different family verifying the same outputs. (graded concrete by review)

**Review signal:** 6.84 / 10 · novelty 7/10

**Strongest objection:** Generation and verification are computationally asymmetric: generation suffers from sequential autoregressive error cascades and sampling drift, whereas verification inspects a complete static reasoning trace with different token contexts and attention patterns. A model sharing weights can readily detect local inconsistencies or arithmetic slips that slipped past generation without requiring decorrelated representations.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** None recorded

---

### 7. H-016: Endogenous expert text is a Lucas limit that scale, fresh data, and context leave closed (out-of-the-box batch)

**Claim:** Once experts use LLMs, later human text and later expert answers are generated under that use. More parameters, more tokens, and a longer context then fit this shifted process more tightly, including when training keeps only fresh human-written documents and drops model-authored ones. That is an identification failure of the kind the Lucas critique names in policy evaluation: records gathered under a policy that changes people's behavior do not identify the next round of behavior. The resulting gap on re-elicited expert judgments survives the three remedies in the research goal.

**Mechanism:** Deployment is a policy change in the macroeconometric sense. Text from the low-use period identifies an answer distribution conditional on low use. After adoption, experts read, write, and judge with model output in the loop, so both the documents a context window can hold and the labels experts now treat as correct depend on the deployed system. A larger sample of that new regime estimates the regime the policy created; it does not recover how the same experts would answer under non-use, and it does not pin down the following round of labels, which moves again as the next model is adopted. Scale shrinks divergence from the training regime and, where the larger model is used more widely, enlarges the policy shock. Extra context adds more post-policy documents, which are descendants of the shock rather than an instrument for the counterfactual. Calculation and proof items stay outside the loop because a derivation fixes their answers, so the same scale increase still cuts error there. The signature is an interaction, measured under one continual-training recipe that admits timestamped human text and excludes model-authored documents: fractional error reduction stays large on the frozen exam and on the original expert answer key, and stays smaller on answers re-elicited from pools that report high LLM use.

**Predictions:** Through 1 October 2028, inside one model family, a later model with at least ten times the parameters and at least ten times the training tokens of an earlier model has lower exact-match absolute error on a frozen exam of at least 100 calculation or proof items whose answers were fixed before the comparison.; Under continual training on post-release human text with model-authored documents removed, that later model's fractional reduction in absolute error against the original 2026 expert key is positive, while its fractional reduction against answers re-elicited on the same items is smaller than its fractional reduction on the frozen exam in any wave where a majority of that expert pool reports LLM use.; At a single calendar date, the shortfall on the re-elicited key is larger in an expert pool with majority LLM use than in a pool with minority LLM use, and the frozen exam shows no corresponding pool interaction.; Doubling the later model's context window and filling the added tokens with the newest human documents leaves the exam-versus-re-elicited split in place.

**Differs from consensus:** The scaling account predicts that a linear error score on expert judgments falls with parameters, data, and context in step with a frozen exam, and the usual freshness account predicts that dropping model-authored documents restores that fall. This hypothesis predicts a split those accounts do not: after model-authored documents are removed and fresh human text is kept, the later model still cuts absolute error on the frozen exam by a larger fraction than on expert answers re-elicited while a majority of the pool uses an LLM. A circuit ceiling predicts the opposite split, with the frozen formal exam as the task that stops improving. A bare causal-hierarchy limit predicts failure on a static interventional query with no adoption interaction; the separating observation here is the high-use versus low-use pool difference on judgment items whose 2026 key remains solvable.

**Evidence basis:** 2 verified source · 1 general knowledge · 1 speculation

**Minimal discriminating experiment:** Preregister both item sets in October 2026. Set A is at least 100 calculation or proof items with immutable answers and exact-match scoring. Set B is at least 100 short judgment items posed to two expert pools that differ in LLM use, repeated every six months, with each expert recording LLM use and with scores kept separately against the October 2026 key and against that wave's key. Train two scales of one family on the same recipe; the later scale has at least ten times the parameters and training tokens, continues on timestamped human text from after the previous release, and is barred from set B answers and from model-authored documents. Evaluate with equal context length and again with the later model's window at least doubled and filled with the newest human documents. Each wave, publish set A error, agreement with the 2026 key, and agreement with the current key, at both scales and both context settings, plus each pool's fraction reporting LLM use. The scaling and freshness accounts predict that the current-key fractional error reduction in the high-use pool keeps up with set A. This claim is separated by a smaller current-key fraction in the high-use pool, a larger fraction on the 2026 key and on set A, and the same pattern at both context lengths.

**Declared falsifier:** The claim is false if, by 1 October 2028, a same-family later model with at least ten times the parameters, at least ten times the training tokens, and at least twice the context window of an earlier model, trained with additional post-release text from which model-authored documents were removed, reduces absolute error by an equal or larger fraction on a re-elicited expert panel than on a frozen exam, where the panel has at least 100 items scored by exact agreement with that wave's answers, the wave has majority self-reported LLM use, the exam has at least 100 calculation or proof items scored by exact match, and both earlier absolute error rates are at least 0.10. (graded concrete by review)

**Review signal:** 6.76 / 10 · novelty 8/10

**Strongest objection:** Expert reliance on LLMs frequently induces cognitive anchoring and output homogenization toward model priors rather than non-stationary divergence. If experts in the high-use pool anchor their judgments on model suggestions, their re-elicited consensus may become more aligned with the model family over time, yielding higher agreement and larger error reduction rather than the predicted Lucas shortfall.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** None recorded

---

### 8. H-012: A larger LLM can become more accurate without acquiring coherent beliefs (out-of-the-box batch)

**Claim:** Through October 6, 2028, increasing model size, training data, and input context while retaining current autoregressive training objectives will fail to make separately elicited probability judgments consistently obey the laws of one shared probability distribution. The proposed limit is reliable coherence across questions: a model can answer individual questions accurately yet assign incompatible probabilities to equivalent decompositions of the same event. This is an empirical scaling hypothesis, not an architectural impossibility theorem.

**Mechanism:** Import the no-arbitrage principle from decision theory: probability judgments about overlapping events should agree sufficiently that a bettor cannot exploit their inconsistency. An autoregressive model defines a distribution over token strings, but its numerical answers to different prompts need not be marginals of one distribution over the described world. Ordinary training rewards each answer locally; it does not explicitly bind answers across equivalent questions. Scaling can therefore improve individual estimates while leaving incompatible estimates across prompts. An explicit shared probability representation would impose the missing constraint.

**Predictions:** On procedurally generated probability problems whose complete specifications fit comfortably in context, larger models will improve individual probability accuracy while retaining discrepancies across equivalent questions.; For an event E and an exhaustive, disjoint partition B, define the discrepancy as abs[p(E) - sum_i p(B_i) * p(E given B_i)], using the model's separately elicited probabilities. Scaling alone will fail to achieve both a 95th-percentile discrepancy below 0.02 and mean absolute error against the exact oracle below 0.03 on every preregistered test family.; Equivalent partitions and randomized event names will produce different discrepancies despite identical underlying probabilities. Additional context containing irrelevant information will not reliably remove them.; Deriving all answers by deterministic marginalization of one model-produced, normalized joint table will eliminate these discrepancies by construction. If individual accuracy remains comparable, that will support shared representation as the missing ingredient.

**Differs from consensus:** The obvious explanation attributes incompatible answers to insufficient knowledge, arithmetic skill, or context capacity and predicts that improved individual accuracy will remove the inconsistency. This hypothesis predicts a residual failure across equivalent questions even after those abilities improve, with a smaller model constrained to a shared probability representation outperforming a larger unconstrained model on coherence.

**Evidence basis:** 1 verified source · 1 general knowledge · 1 speculation

**Minimal discriminating experiment:** Preregister three synthetic probability generators: finite urn worlds, binary Bayesian networks, and mixtures with hidden group membership. Generate 200 held-out worlds per family after checkpoint selection, with exact answers computed by enumeration and conditional branch probabilities bounded away from zero. Ask each model direct, conditional, and partition-based questions in separate calls using the same complete world specification. Evaluate a controlled ladder of at least three model sizes and three training-data amounts, including additional task-specific examples under the same objective. Compare ordinary answering with deterministic marginalization of a single elicited joint table. Freeze prompts, decoding, reasoning budgets, thresholds, and model-selection rules before evaluation. Report accuracy and coherence separately, use world-level bootstrap intervals, and include arithmetic controls and constant-probability baselines. A current-model pilot tests whether the proposed dissociation exists; failure to find it weakens the hypothesis immediately.

**Declared falsifier:** By October 6, 2028, a controlled scaling study independently replicated by a second team demonstrates that a model trained with unchanged autoregressive objectives achieves both mean absolute probability error below 0.03 and 95th-percentile decomposition discrepancy below 0.02 in every preregistered test family, including unseen graph structures, event relabelings, and alternative partitions. The model must answer separate queries without external solvers or enforced cross-query consistency. Task-specific examples are allowed and count as a data-based falsification. (graded concrete by review)

**Review signal:** 6.53 / 10 · novelty 7/10

**Strongest objection:** On fully specified finite worlds with a unique oracle, the law of total probability makes cross-query agreement mostly a corollary of per-query accuracy: once each elicited number is close to the same true value, the decomposition gap shrinks up to a factor set by partition size. The declared falsifier also counts task-specific examples under an unchanged autoregressive objective, which is the supervision that teaches finite enumeration, and it rejects the hypothesis only when accuracy and coherence both clear their bars on every family. A result in which models remain inaccurate, or in which the residual gap is exactly the gap predicted by ordinary per-query error, therefore leaves the official claim standing while confirming the consensus account that this is calculation error rather than a missing shared probability representation. The only verified evidence is an older underspecification analogy that does not show an LLM discrepancy surviving after individual error has already fallen below the accuracy threshold.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** None recorded

---

### 9. H-004: Correlated Verifier Attractor Horizon in Non-Executable Epistemic Self-Correction (out-of-the-box batch)

**Claim:** Current and scaled autoregressive LLMs possess an intrinsic epistemic ceiling in autonomous error correction: in non-executable reasoning domains lacking external deterministic feedback (such as compilers, unit test runners, or formal proof checkers), scaling parameters, pre-training data volume, and context window lengths sharpens and amplifies shared latent attractor basins, causing recursive self-critique to systematically entrench subtle consensus fallacies rather than resolve them.

**Mechanism:** Pre-training objective functions minimize cross-entropy over human textual corpora, shaping the metric tensor of the model's latent representation space such that semantic co-occurrences form low-energy attractor basins. When an LLM generates a fallacious premise aligned with dominant textual priors, its internal critique or verifier head evaluates revisions within that identical geometric curvature. Increasing parameter scale and pre-training data density deepens these attractor basins, while expanding context window size introduces autoregressive prefix anchoring that biases subsequent attention layers toward the generated fallacy. Because generator and verifier share the same underlying representation geometry, recursive self-refinement without external ground-truth interaction creates positive feedback loops where false-to-true revisions asymptotically plateau while true-to-false revisions accumulate, imposing a fundamental verification horizon independent of scale.

**Predictions:** On non-executable reasoning benchmarks with counter-intuitive ground truth, increasing unassisted multi-turn self-critique iterations (from 1 to 5+) will result in a monotonic decrease in net revision accuracy across frontier models >=100B parameters.; Scaled frontier models will exhibit significantly higher output confidence on their erroneous revisions than smaller models, demonstrating scale-dependent calibration degradation under ungrounded reflection.; Multi-model debate between distinct frontier LLM families (Claude, GPT, Gemini) will converge to the consensus error in >=70% of trials on these tasks due to shared pre-training manifold geometry.; The verification horizon evaporates immediately when an external deterministic discriminator (such as an execution sandbox or symbolic proof solver) is introduced, confirming that the failure is representation-geometry entanglement rather than compute or context capacity.

**Differs from consensus:** The dominant consensus asserts that scaling model parameters and test-time verification compute (via process reward models, multi-turn self-refinement, debate, or tree search) enables models to autonomously bootstrap superhuman reasoning across all intellectual domains. This hypothesis predicts the inverse for non-executable domains: recursive test-time self-critique will exhibit a divergence threshold where reflection depth monotonically degrades accuracy on counter-intuitive truths, with larger models demonstrating more pronounced, high-confidence confirmation bias than smaller models.

**Evidence basis:** 2 verified context · 1 general knowledge · 1 speculation

**Minimal discriminating experiment:** Curate an evaluation set of 300 non-executable reasoning problems across medicine, historical counterfactuals, and causal inference where the true outcome contradicts high-frequency web text priors. Evaluate frontier models under zero, one, three, and five iterations of prompt-based and RL-guided self-critique without external tools. Measure the ratio of false-to-true vs true-to-false belief flips and model calibration. The claim is supported if net truth flips are negative and self-critique error concentration correlates positively with parameter scale.

**Declared falsifier:** An empirical demonstration within the next two years of a frontier LLM (>=100B parameters) operating strictly without external tools, compilers, simulators, or retrieval, achieving autonomous error correction via internal multi-turn self-critique on a benchmark of >=200 counter-intuitive non-executable reasoning tasks, where recursive reflection monotonically improves task accuracy from below random baseline (<40%) to robust competence (>80%) without confidence collapse. (graded concrete by review)

**Review signal:** 6.38 / 10 · novelty 7/10

**Strongest objection:** The only verified support is that overlapping training text makes models restate consensus and treats cross-model agreement as non-independent. That does not establish a shared latent geometry, a scale-deepened basin, or a regime where more self-critique monotonically converts true answers into false ones. Ungrounded next-token repetition already predicts weak tool-free self-correction and does not predict that larger models and deeper reflection get worse. Selecting medicine, history, and causal items precisely because they contradict frequent web text builds the failure into the sample, and contested labels can manufacture true-to-false flips.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** None recorded

---

### 10. H-009: LLMs fail to conserve evidence when its representation changes

**Claim:** A candidate limit is failure to distinguish evidence quantity from text quantity. My forecast is that, through 2028-10-06, increasing model width, depth, training data, or context length under an unchanged training recipe will leave systematic confidence changes when one observation is copied, paraphrased, or split into multiple reports, even when the reports' common ancestry is explicitly supplied. This is an empirical hypothesis about learned evidence accounting, not an impossibility theorem.

**Mechanism:** Probabilistic evidence should be counted according to independent observations. Token prediction instead rewards sensitivity to frequency, repetition, and presentation. The conjecture is that models learn many local warnings about duplicate sources without learning a consistently applied conservation rule: copying an observation must add zero information. Longer contexts can therefore amplify apparent support while preserving the actual information available. An explicit provenance ledger would impose the missing invariant.

**Predictions:** On synthetic inference problems, copying a report 1, 4, 16, or 64 times will shift the reported posterior toward that report's favored hypothesis despite unchanged underlying observations and disclosed ancestry.; Larger models will improve accuracy on canonical packets while retaining a mean absolute posterior difference exceeding 0.05 between logically equivalent packets.; Deterministically collapsing reports to their independent ancestors will reduce the representation effect more than adding an equally long instruction explaining source dependence.

**Differs from consensus:** Against the explanation that more context mainly improves grounding by exposing additional support, this predicts that more text can increase confidence without adding information, including when dependence is explicitly described. The decisive variable is independent evidence ancestry rather than token count.

**Evidence basis:** 1 verified context · 2 speculation

**Minimal discriminating experiment:** Generate 2,000 small Bayesian problems with known independent observations and explicit report-ancestry graphs. Randomize equivalent canonical, copied, paraphrased, and split-report packets within each problem. Supply posterior lookup tables, counterbalance ordering, and score both correctness and paired posterior differences. Compare unprocessed packets with deterministic ancestry collapse using the same model. If the baseline representation effect is already below 0.02, reject the proposed present-day limit immediately; otherwise freeze the generator and evaluate controlled scaling checkpoints through October 2028.

**Declared falsifier:** By 2028-10-06, a model improved solely through width, depth, additional static training data, or context capacity achieves posterior mean absolute error below 0.03 and a paired representation effect below 0.02 in every preregistered copying, paraphrasing, and report-splitting stratum, with 95% confidence upper bounds below those thresholds, on fresh generators in an independent replication. No external deduplication or provenance ledger may perform the accounting. (graded concrete by review)

**Review signal:** 6.31 / 10 · novelty 6/10

**Strongest objection:** With the ancestry graph, prior, likelihoods, and exact posterior lookup tables all supplied and an adequate scratchpad allowed, the task reduces to a deterministic collapse-then-lookup procedure that frontier models may already execute near-perfectly, so the present-day effect could fall under the 0.02 threshold and the 'limit' would evaporate before any scaling question arises. If the effect does persist, the design cannot separate a specific failure of evidence conservation from a generic degradation of multi-step reasoning and instruction-following as packet length and clutter grow. Additionally, the 'unchanged training recipe' clause is unobservable for any production model, so a passing frontier model can always be dismissed as a recipe change, which weakens the falsifier in practice.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** None recorded

---

### 11. H-010: Self-generated commitments create a belief-revision tax

**Claim:** A candidate limit is asymmetric correction: an LLM handles decisive evidence worse after it has committed to the wrong answer itself. My forecast is that scaling models, static training data, and context will not eliminate a correction-accuracy penalty of at least 10 percentage points relative to receiving the same mistaken answer as an unauthored draft. The bottleneck is learned continuation behavior rather than insufficient knowledge or computational expressivity.

**Mechanism:** An autoregressive model's previous answer becomes part of the input that determines its continuation. The conjecture is that training rewards coherent continuation strongly enough that an assistant-authored commitment acts as an attractor: subsequent reasoning repairs the story around the commitment instead of replacing it. Retaining a longer transcript preserves that attractor. Static examples of corrections may teach correction language without reliably teaching recovery from the model's own mistaken trajectories.

**Predictions:** When a short, mechanically checkable counterexample arrives, models will correct an unauthored mistaken draft more often than an otherwise identical assistant-authored answer.; Removing the earlier commitment while preserving all task evidence will restore accuracy; adding more explanatory context will provide a smaller benefit.; Scaling will improve initial answers faster than correction conditional on an initial error, whereas training on recovery from actual model-generated mistakes will disproportionately improve correction.

**Differs from consensus:** This contradicts the explanation that failed correction is mainly a lack of reasoning capacity or accessible evidence. It predicts an authorship-dependent error gap with identical decisive evidence, and recovery when the commitment is removed without adding knowledge.

**Evidence basis:** 2 verified source · 1 speculation

**Minimal discriminating experiment:** Create 1,000 tasks with an initially plausible wrong answer and a later decisive counterexample. Replay matched transcripts under randomized assistant-authored, unauthored-draft, and commitment-removed conditions. Require a revised answer plus a machine-checkable justification. Measure correction accuracy and rationalizations that preserve the refuted answer. Establish the attribution effect before conducting a scaling study; compare static correction training with an equal-token recovery curriculum built from actual model errors.

**Declared falsifier:** By 2028-10-06, a controlled scaling successor using the same training objectives achieves at least 95% correction accuracy and an authorship penalty below 2 percentage points across preregistered logic, program-trace, and synthetic causal tasks, with simultaneous 95% confidence bounds satisfying both criteria, independently replicated on fresh instances. Scaling may include more static correction data, greater depth, longer context, and longer scratchpads. (graded concrete by review)

**Review signal:** 6.31 / 10 · novelty 6/10

**Strongest objection:** The claim excludes the most obvious remedy by definition: RL or fine-tuning on model-generated mistakes is treated as outside 'scale, data, and context', yet this is already standard post-training at frontier labs, so the proposed 'limit' may describe a training regime no deployed model relies on, and the falsifier's 'same training objectives' clause cannot be audited against real frontier models. Separately, the authored-vs-unauthored contrast confounds autoregressive commitment with role framing: a draft placed in a user or document turn implicitly cues critique mode, and conditional-on-error subsets shrink and harden as models scale, so a persisting penalty could reflect selection on harder residual errors rather than a commitment attractor.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** None recorded

---

### 12. H-002: Epistemic Modality Blindness in Key-Value Caches Inducing Unrecoverable Confirmation Drift

**Claim:** Autoregressive transformers cannot autonomously recover from early conjectural errors during extended reasoning traces because the key-value (KV) attention cache treats hypothetical conjectures and verified ground-truth premises with identical epistemic status, causing self-priming confirmation cascades.

**Mechanism:** In autoregressive transformers, generated tokens are appended sequentially to the KV cache and participate symmetrically in future multi-head attention calculations. The architecture lacks an epistemic status register to distinguish whether an in-context proposition represents an empirical premise, an axiomatic truth, or a tentative speculative scratchpad thought. When an LLM introduces an erroneous speculative deduction during extended thinking, those tokens act as positive semantic attractors in the attention mechanism. Because training maximizes likelihood over human text that exhibits internal rationalization, the self-attention heads attend to self-generated tokens and generate mutually coherent rationalizations rather than disconfirming critiques. Scaling context length and parameters compounds this failure: larger models possess higher expressive capacity to construct sophisticated rationalizations for prior erroneous tokens, driving error-recovery probability asymptotically toward zero over long reasoning horizons.

**Predictions:** Injecting a subtle false premise at step 2 of a 50-step formal derivation will cause models to produce convincing false conclusions in >90% of trials, with self-critique steps validating the erroneous chain rather than catching it.; Increasing test-time thinking budget on counter-intuitive logic problems will exhibit non-monotonic accuracy: performance will initially rise on shallow puzzles but degrade on deep deceptive puzzles due to rationalization lock-in.; Attention entropy over earlier thinking steps will decrease over time as attention heads concentrate heavily on self-generated premises, exhibiting positive feedback dynamics.

**Differs from consensus:** Dominant AI paradigm assumes extended test-time computation and autonomous self-critique will mimic AlphaZero's self-play to transcend human performance. This hypothesis asserts that without an external ground-truth simulator or architectural epistemic partitioning in the KV cache, ungrounded self-critique inevitably degenerates into self-consistent confirmation drift.

**Evidence basis:** 2 verified context · 1 general knowledge · 1 speculation

**Minimal discriminating experiment:** Construct 500 multi-step logical and mathematical derivation tasks. For each, prompt frontier reasoning models with either a correct start or an artificially injected false premise at step 2. Measure whether extended thinking tokens (>10K tokens) successfully prune the false branch or reinforce it through elaborate justification.

**Declared falsifier:** Within two years, an autoregressive model without external tools, compilers, or verifiers achieves >85% autonomous error detection and correction on deceptive multi-step mathematical proofs when initialized with a subtle false premise at step 2 of a 20-step proof; or demonstration that increasing thinking tokens up to 100,000 tokens per problem monotonically eliminates false rationalizations on counter-intuitive benchmarks without tool assistance. (graded concrete by review)

**Review signal:** 6.16 / 10 · novelty 6/10

**Strongest objection:** No epistemic metadata bit in the KV cache does not make conjectures and premises indistinguishable: status can be written into token content and therefore into key/value geometry, and content-dependent attention can down-weight a later retraction. The verified evidence only shows that agreement among models trained on the same literature is not independent confirmation; it does not support architectural unrecoverability or recovery probability falling toward zero as scale, data, or context grow.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** None recorded

---

### 13. H-007: The verifier floor, not the architecture: every scale-resistant limit is the reliability of the signal used to train and measure the model

**Claim:** No limit of current LLMs is internal to the architecture or the pretraining objective in a way that survives scale plus multi-step decoding. What survives is that a model's accuracy in a domain converges to, and cannot exceed, the reliability of the best verifier used to train and evaluate it. Plateaus appear wherever that verifier is human judgement and disappear wherever it is mechanical (test suites, proof checkers, simulators, symbolic solvers).

**Mechanism:** Pretraining, preference tuning, and benchmark scoring all optimize agreement with a signal. When the signal is a learned proxy or human labels, label noise and verifier error set an asymptote that optimization reaches and then overshoots, as reward-model overoptimization shows. When the signal is mechanical there is no noise floor, so gains continue. Circuit-complexity ceilings are lifted by intermediate decoding steps, and the calibration lower bound on hallucination concerns facts that no verifier can check, so both reduce to the same observation: progress stops where verification stops, not where the architecture stops. The apparent 'hard limits' are the verifier floor seen from inside the model.

**Predictions:** In a 2x2 design crossing task class (claimed outside TC0 versus inside) with verifier type (mechanical versus human-judged), accuracy across three frontier generations keeps rising in the mechanical column regardless of task class and plateaus in the human-judged column regardless of task class.; The height of a human-judged plateau moves when verifier quality changes (crowd versus expert labels) and does not move when training compute changes by 10x.; The same skill measured two ways (hidden-test code versus human-rated code) plateaus only under the human-rated measurement, and the plateau sits near the raters' inter-rater agreement.; Scale-resistant hallucination on singleton facts tracks the absence of any verifier for those facts; where a mechanical fact-check exists for the same question type, hallucination declines with scale.

**Differs from consensus:** The dominant explanations in this context locate the limit inside the model: constant-depth transformers are confined to TC0, calibrated models must hallucinate on singleton facts, the next-token objective induces shortcuts. Those accounts predict plateaus located by task class, independent of how answers are checked. This hypothesis predicts plateaus located by verifier type, independent of task class. The observation that settles it is a mechanically verified task family from a class claimed to be outside TC0 that keeps improving across generations while a TC0-class task with human-judged scoring plateaus at the raters' agreement level.

**Evidence basis:** 1 verified context · 4 verified source · 1 speculation

**Minimal discriminating experiment:** Build the 2x2: one task family inside TC0 and one claimed outside it (linear-system solving or context-free parsing), each in a mechanically checked form and a human-rated form with measured inter-rater agreement. Evaluate three model generations with chain-of-thought allowed. The hypothesis predicts plateaus aligned with the verifier column; the architectural account predicts plateaus aligned with the task-class row.

**Declared falsifier:** By October 2028, a task family with a mechanical verifier (Lean-checked proofs, hidden-test code, or symbolic equation solving checked by a computer algebra system) on which accuracy is flat within 2 points across two consecutive frontier generations separated by at least 10x training compute, while those same two generations improve by at least 10 points on another mechanically verified family. (graded concrete by review)

**Review signal:** 5.76 / 10 · novelty 7/10

**Strongest objection:** Verifier reliability is not a general upper bound on model accuracy: a model can recover a consistent underlying rule from many independently noisy labels and outperform individual labelers. Conversely, perfectly checking an answer does not make discovering it computationally tractable or learnable. The verified evidence supports proxy overoptimization, measurement artifacts, and conditional expressivity results, but none establishes the universal claim. Changing evaluation alone also cannot demonstrate a change in underlying capability, and inter-rater agreement is not an accuracy ceiling.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** None recorded

---

### 14. H-015: Overoptimization peaks at residual disagreement rank, not at scale

**Claim:** The limit that policy scale, more preference data from the same prompt distribution, and a longer decision-time context do not remove is the rank of residual disagreement between the proxy reward and held-out humans. Held-out human win rate rises with optimization distance and then falls. The KL from the reference at which it peaks is set by that residual rank. Reward-model size, preference-data volume, and policy parameter count move the peak only when they change the rank. With rank matched to within 10 percent, a policy at least ten times larger peaks at the same KL as the smaller policy, and its win rate is not still rising after the smaller policy's win rate has turned down.

**Mechanism:** Fisher's geometric picture of adaptation: true preference is one direction in behavior space, and each update along a proxy has a component in the orthogonal complement. The typical size of that wasted component grows with the square root of the number of orthogonal dimensions, so true preference improves and then declines at a distance fixed by that dimension count. Residual rank on a frozen probe of human disagreements is the empirical count of those dimensions. A larger policy can travel farther into the orthogonal complement and does not peak later unless the proxy has actually shrunk the complement. A larger reward model, or more labels, shrinks the complement only along directions present in the labels. Resampling the same prompt distribution adds replicates, not new directions. A longer context at decision time does not change how many preference directions the proxy misses.

**Predictions:** On a frozen probe of human pairwise judgments disjoint from proxy training, two policies whose parameter counts differ by at least tenfold, optimized against proxies matched to within 10 percent residual rank, have held-out human win-rate peaks within 0.1 nats KL of a shared reference.; Cutting residual rank by about half, with policy size and reward-model size held fixed, moves the peak to a larger KL and raises the peak held-out win rate.; Increasing preference-data volume by resampling the same prompt distribution, so residual rank stays within 10 percent, does not move the peak by more than 0.1 nats.; Lengthening the policy's context at decision time, with weights and proxy held fixed, does not move the peak by more than 0.1 nats.; The rise-and-fall shape appears in fresh human win rates, not only in the score of a frozen synthetic gold reward model.

**Differs from consensus:** The scaling account of reward overoptimization says reward-model size, preference-data size, and policy size each change the curve's coefficients, so further scale along the proxy is the variable that moves how far optimization remains helpful. This hypothesis predicts those coefficients shrink to about zero once residual disagreement rank is held fixed: a tenfold policy-size gap at matched rank leaves the KL of the held-out human peak unmoved, within 0.1 nats. The settling observation is that matched-rank comparison. Peaks separated by more than 0.1 nats, or a larger policy whose held-out win rate is still rising after the smaller one has fallen, settle it in favor of scale as a direct coefficient.

**Evidence basis:** 2 verified source · 1 general knowledge · 1 speculation

**Minimal discriminating experiment:** Freeze a human probe set and a disjoint rater pool. Train proxies of different sizes and adjust only their label coverage until residual rank on the probe matches within 10 percent. From one reference policy, optimize a small policy and a policy at least ten times larger against each matched proxy, sweeping KL. Score every checkpoint with fresh raters. The critical cell is matched rank and unmatched policy size. A second cell cuts rank by about half at fixed policy size and fixed reward-model size by adding judgments on probe directions the proxy misses. A third cell resamples in-distribution preference data so volume rises and rank does not. Report the KL of the peak win rate in each cell.

**Declared falsifier:** Before October 2028, two policies that differ by at least tenfold in parameter count, trained against proxies whose residual disagreement ranks on the same held-out human probe differ by under 10 percent, show either held-out human win-rate peaks separated by more than 0.1 nats of KL from a shared reference, or the larger policy's held-out win rate still rising at a KL where the smaller policy's held-out win rate has already fallen by at least 5 points. (graded concrete by review)

**Review signal:** 5.52 / 10 · novelty 8/10

**Strongest objection:** Residual rank does not determine residual error magnitude, spectrum, alignment with policy updates, or preference curvature. Those quantities can change while rank remains fixed and can plausibly move the optimization peak. A noisy disagreement matrix may also remain full-rank while prediction quality improves substantially. The verified evidence supports synthetic reward overoptimization and scale-dependent curves; it does not establish rank mediation or the claimed invariance in fresh human judgments.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** None recorded

---

### 15. H-001: Geometric Superposition Interference Ceiling in Simultaneous Multi-Constraint Composition

**Claim:** Dense transformer architectures exhibit an intrinsic mathematical error floor on tasks requiring simultaneous verification of K mutually orthogonal constraints, caused by non-orthogonal feature cross-talk in superposed activation space that expands exponentially faster than width scaling can separate.

**Mechanism:** Transformer feed-forward layers store vastly more semantic features than activation dimensions d by utilizing non-orthogonal polysemantic superposition. When an inference problem requires simultaneously activating K mutually independent constraint representations, the inner-product interference (cross-talk noise) between active feature vectors scales as O(K / sqrt(d)). Because combinatorial constraint satisfaction problems expand candidate constraint interactions exponentially (C^K), the aggregate projection noise exceeds the activation threshold of unactivated features, creating phantom feature detections in internal hidden states. Scaling model width d increases capacity only quadratically (~d^2), which is asymptotically outpaced by the exponential growth of multi-constraint interference. Extending context window or training dataset size cannot alleviate this bottleneck because the cross-talk occurs within the instantaneous feed-forward activation space during single-token evaluation steps.

**Predictions:** On synthetic N-SAT and multi-color graph consistency tasks, model accuracy will exhibit a sharp phase transition drop when concurrent active constraints K exceed c * sqrt(d), regardless of chain-of-thought token length.; Probing intermediate MLP activations during high-constraint tasks will reveal high-magnitude activation of orthogonal, irrelevant constraint features (phantom activations) directly preceding logical failures.; Sparse autoencoders trained on model residual streams will demonstrate catastrophic activation correlation among nominally independent constraint features precisely when K passes the critical threshold.

**Differs from consensus:** Mainstream literature attributes constraint satisfaction failures to autoregressive greedy search or insufficient test-time search tokens (fixable via Monte Carlo tree search, extended chain-of-thought, or RL reasoning models). This hypothesis posits that the bottleneck is an architectural geometric limit in dense superposition: simultaneous constraint evaluation produces constructive interference noise in hidden states that misleads internal verifiers regardless of search horizon or parameter scale.

**Evidence basis:** 2 general knowledge · 1 speculation. No verified context evidence: the claim rests on unverified memory or speculation

**Minimal discriminating experiment:** Construct a synthetic benchmark of modular constraint problems where K orthogonal logical rules must be verified simultaneously. Test models with varying parameter sizes (7B to 400B+) and chain-of-thought budgets (1K to 32K tokens). Measure error rate against K to test whether failure is governed by K / sqrt(d) rather than search budget.

**Declared falsifier:** Within two years, an unmodified dense transformer with dimension d <= 16384 achieves >= 98% zero-shot accuracy on synthetic constraint satisfaction problems with K >= 30 concurrent orthogonal constraints without external SAT solvers, where linear probes confirm zero cross-talk between orthogonal constraint vectors in hidden layers; or empirical proof that scaling test-time chain-of-thought tokens monotonically increases accuracy toward 100% on K=50 exact constraint satisfaction benchmarks without saturating at an error floor. (graded vague by review)

**Review signal:** 4.76 / 10 · novelty 6/10

**Strongest objection:** A transformer never has to represent all K constraints at once: a reasoning trace that checks one constraint per step keeps co-active constraint features at O(1), so the claimed c*sqrt(d) threshold never binds. Empirically, test-time-compute scaling on multi-constraint logic puzzles has produced large accuracy gains rather than a width-determined plateau, which is the opposite of what the mechanism predicts for CoT-independent failure.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** The mechanism only bounds interference among features that are co-active in a single forward pass, yet the claim asserts the floor holds regardless of chain-of-thought length. Chain-of-thought serializes constraint checking so that only O(1) constraint features need to be co-active per token, with the remaining state held in context and retrieved by attention over positions, a channel the K/sqrt(d) argument does not touch. The asymptotic argument is also mathematically unsupported: the number of near-orthogonal directions packable in d dimensions grows exponentially with d (Johnson-Lindenstrauss), not quadratically, and the C^K term counts candidate assignments, not simultaneously active features. Without those two steps the hypothesis does not deliver a limit that is immune to scale and context, which is the research goal.

---

### 16. H-003: Invariant Dissipation in Continuous Softmax Attention across Deep Compositional Sequences

**Claim:** Continuous softmax attention mechanisms cannot preserve discrete mathematical invariants across deep serial compositions without exponential variance accumulation, setting a hard upper bound on composition depth N that does not scale with parameter count or context length.

**Mechanism:** In tasks requiring strict invariant conservation over sequential state transformations (e.g., tracking permutation cycles in bipartite graphs, register aliasing in execution traces, or parity across multi-hop relational chains), each transformer layer applies continuous softmax attention: softmax(QK^T / sqrt(d_k))V. Because softmax produces a dense probability distribution with full support, off-target attention weights are strictly non-zero (epsilon > 0) for every token position. Across N serial composition steps, the fidelity with which a discrete state invariant is routed decays as (1 - epsilon)^N. Extending the context window worsens this degradation by increasing the number of distractor tokens in the softmax denominator. Increasing model scale reduces epsilon per layer but cannot eliminate it without collapsing the softmax temperature to zero, which destroys representational flexibility. Consequently, compositional depth has an architectural ceiling beyond which discrete invariant tracking degrades into uniform noise.

**Predictions:** Tracking object swaps in a closed system of M items will exhibit exponential decay in state accuracy as the number of sequential swaps N increases, strictly obeying an exponential decay function (1 - epsilon)^N.; Increasing model parameters by an order of magnitude will only linearly increment the maximum compositional depth N_max achievable before accuracy falls below 50%.; Expanding context length by prefixing irrelevant background text will accelerate the error rate per composition step due to distractor mass accumulation in the attention distribution.

**Differs from consensus:** Dominant theoretical literature assumes transformers with chain-of-thought are Turing-complete and that scaling context and parameter depth allows arbitrarily deep compositional reasoning. This hypothesis argues that continuous softmax routing introduces non-zero state dissipation at every step, creating an exponential decay of discrete invariants that cannot be eliminated by parameter scaling or longer contexts.

**Evidence basis:** 2 general knowledge · 1 speculation. No verified context evidence: the claim rests on unverified memory or speculation

**Minimal discriminating experiment:** Generate synthetic state-tracking benchmarks with M = 10 objects subjected to N sequential pairwise swaps (N varying from 10 to 500). Measure final state accuracy across model scales (8B, 70B, 400B+) and context lengths. Fit empirical accuracy curves to (1 - epsilon)^N to determine whether epsilon remains strictly bounded above zero across all scales.

**Declared falsifier:** Within two years, an unmodified transformer architecture achieves >= 99.5% accuracy on tracking N = 500 sequential node swaps on a 20-node graph using purely internal chain-of-thought, exhibiting zero exponential decay in per-step tracking fidelity; or proof of an architectural configuration of standard softmax attention that achieves hard discrete permutation routing (epsilon = 0) while maintaining continuous gradient-based learning on general language tasks. (graded concrete by review)

**Review signal:** 4.47 / 10 · novelty 4/10

**Strongest objection:** The mechanism confuses continuous mixing with information loss. If the correct binary value receives attention mass greater than one-half, its identity remains exactly recoverable despite positive distractor weights; a nonlinear restoration operation can prevent errors from accumulating. The argument supplies no reason standard transformer components cannot perform such restoration. Even accepting the proposed decay equation, N_max grows approximately as 1/epsilon, making its scaling depend on how epsilon changes with model size. None of the supplied evidence is verified, and the strict exponential law and exponential variance claim are not derived.

**Adversarial competing explanation:** Not selected for finalist falsification

**Unresolved fatal flaw:** Positive off-target attention mass does not imply irreversible discrete-state error. Moreover, epsilon > 0 at every finite scale does not establish a scale-independent positive lower bound on epsilon, so the proposed decay equation cannot establish a scale-independent depth ceiling.

---

## Duplicates retained for audit


## Sources

14 source records were available to the council (0 supplied with the run, 14 proposed by 3 web scouts over 2 rounds). Verification mode: fetch; every record was graded blind by a council provider. Reachable means the URL resolved, not that the work is correct; summaries and grades are model-written.

| Id | Kind | Title | Year | Verification | Reliability | Replication |
| --- | --- | --- | --- | --- | --- | --- |
| S-001 | paper | [On Limitations of the Transformer Architecture](https://arxiv.org/abs/2402.08164) (doi:10.48550/arxiv.2402.08164) | 2024 | reachable | 7/10 | unknown |
| S-002 | preprint | [Why Language Models Hallucinate](https://arxiv.org/abs/2509.04664) (doi:10.48550/arxiv.2509.04664) | 2025 | reachable | 7/10 | unreplicated |
| S-004 | paper | [Potemkin Understanding in Large Language Models](https://arxiv.org/abs/2506.21521) (doi:10.48550/arxiv.2506.21521) | 2025 | reachable | 6/10 | unreplicated |
| S-005 | paper | [Are Emergent Abilities of Large Language Models a Mirage?](https://arxiv.org/abs/2304.15004) (doi:10.48550/arxiv.2304.15004) | 2023 | reachable | 8/10 | replicated |
| S-008 | paper | [The Expressive Power of Transformers with Chain of Thought](https://arxiv.org/abs/2310.07923) | 2024 | reachable | 8/10 | replicated |
| S-011 | paper | [The Parallelism Tradeoff: Limitations of Log-Precision Transformers](https://arxiv.org/abs/2207.00729) (doi:10.48550/arxiv.2207.00729) | 2023 | reachable | 8/10 | replicated |
| S-015 | paper | [Calibrated Language Models Must Hallucinate](https://arxiv.org/abs/2311.14648) (doi:10.48550/arxiv.2311.14648) | 2024 | reachable | 8/10 | unknown |
| S-018 | paper | [The Pitfalls of Next-Token Prediction](https://arxiv.org/abs/2403.06963) (doi:10.48550/arxiv.2403.06963) | 2024 | reachable | 7/10 | replicated |
| S-021 | paper | [Underspecification Presents Challenges for Credibility in Modern Machine Learning](https://jmlr.org/papers/v23/20-1335.html) | 2022 | reachable | 8/10 | replicated |
| S-022 | paper | [Latent Causal Probing: A Formal Perspective on Probing with Causal Models of Data](https://arxiv.org/abs/2407.13765) | 2024 | reachable | 7/10 | unreplicated |
| S-023 | preprint | [Interventional Causal Representation Learning](https://arxiv.org/abs/2209.11924) | 2022 | reachable | 7/10 | unreplicated |
| S-024 | preprint | [Transformers, parallel computation, and logarithmic depth](https://arxiv.org/abs/2402.09268) | 2024 | reachable | 7/10 | unreplicated |
| S-025 | paper | [Probabilistic Reasoning across the Causal Hierarchy](https://arxiv.org/abs/2001.02889) (doi:10.48550/arxiv.2001.02889) | 2020 | reachable | 9/10 | replicated |
| S-029 | paper | [Scaling Laws for Reward Model Overoptimization](https://arxiv.org/abs/2210.10760) (doi:10.48550/arxiv.2210.10760) | 2023 | reachable | 9/10 | replicated |

Concerns raised by the critique:

- S-001: Proved for one transformer layer via communication complexity; depth and chain-of-thought lie outside the theorem; The scale, data, and context slogan is broader than the single-layer statement
- S-002: Preprint extension of the STOC calibration bound; the evaluation-incentive half is not independently replicated; Binds arbitrary singleton facts under guessing-rewarded scoring; abstention or a changed objective is an escape the argument already allows
- S-004: Potemkin rate is specific to their definition-versus-application procedure and lacks an independent replication; A cross-model snapshot does not show that further scale leaves the gap intact
- S-005: Shows that nonlinear metrics manufacture apparent emergence; it does not show that complexity or identifiability limits are measurement artifacts
- S-008: Expressivity holds under stated precision, normalization, and intermediate-decoding assumptions; learnability is open
- S-011: TC0 simulation is for log-precision, fixed-depth, one-pass transformers; chain-of-thought steps leave that class; The summary's L≠P condition needs to be checked against the paper's actual separation hypothesis
- S-015: Lower bound assumes calibration and concerns arbitrary facts at singleton rates, not systematic knowledge; Abstention or any post-training that breaks calibration falls outside the hypothesis
- S-018: Primary evidence is teacher-forced path-finding on synthetic star graphs; Their teacherless multi-token fix shows the failure is objective-specific rather than a capacity limit
- S-021: predates modern large-scale autoregressive LLMs
- S-022: synthetic benchmark only; probing does not establish behavioral causal competence
- S-023: theoretical assumptions not demonstrated in generative language models
- S-024: worst-case circuit complexity bounds may not constrain practical average-case performance
- S-025: formal causal graph framework does not directly address observational text describing causal processes
- S-029: relies on synthetic gold reward models rather than direct human preference distributions

## Council disagreements and limitations

- Dropped 2 source record(s): S-026 (Language identification in the limit) could not be fetched: HTTP 403; S-028 (Cryptographic limitations on learning Boolean formulae and finite automata) could not be fetched: HTTP 403
- 13 source record(s) did not fit the shared context budget and were left out of the packet
- Empty generation response from cli-agy; retried once
- Authorship-label blinding does not remove provider-specific writing style.
- Novelty was judged only against the supplied context.
- Evidence verification checks quotes against the shared packet; it cannot validate general-knowledge claims, which remain unverified literature memory.

## Session configuration

- Novelty: 8/10 (flag) · Skepticism: 5/10 (default)
- Review aggregate: weighted mean of six review scores (novelty x1.45, robustness x1.00, others ×1.00)
- Consensus crowding: similarity threshold 0.39; crowded candidates lose 0.90 points
- Unsupported evidence: candidates without verified context evidence are flagged but not penalised
- Gates: fatal flaw, then untestable falsifier
- Generation: 3 hypotheses per provider plus 1 out-of-the-box call per provider requesting 1
- Falsification rounds per finalist: 1
- Prompt versions: blind-review:v4, falsification:v4, hypothesis-generation-outofbox:v1, hypothesis-generation-repair:v4, hypothesis-generation:v4, source-critique:v1, source-scout:v1

## Context and reproducibility

- Session: RC-20261007-010444Z-6aa049
- Seed: 42
- Providers: cli-agy, cli-claude, cli-codex, cli-grok
- Context packet SHA-256: f7e09748ba199b5dfaabf9432f6ce351ffb86cd19d1c8ca236234cd246adb7fa
- Sources: 14 records (14 reachable); verification fetch
- Prompt versions and raw outputs: 37 recorded calls in the session directory
