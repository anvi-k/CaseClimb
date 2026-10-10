# Clinical education, patient behavior, and assessment

Research checked: **2026-10-10**. This note examines educational design; it does not establish that CaseClimb has been clinically validated or that its future scores can certify clinical competence. Proposed design choices below are labeled separately from published findings.

## Recommended scope and what the evidence supports

Start with one **10-minute, faculty-authored ED encounter** targeting a small number of history-taking and communication objectives, followed by a separate debrief and a repeat attempt. Concurrent practice and repeatability are plausible product advantages; actual capacity, cost, learning benefit, and transfer to real patients need measurement.

A primary randomized study of 82 senior medical students used ten-minute encounters and found higher post-training SEGUE total and content scores for AI virtual-patient practice than human standardized-patient practice; process scores were similar. The study used **no visual avatars**. Its AI group received detailed feedback after training encounters while the human-SP group did not, so modality, feedback, and practice opportunity were bundled. Single-institution, short-term results do not establish superiority in empathy, clinical relationships, or real patient outcomes. Ten minutes therefore has feasibility precedent, not evidence that it is the optimal duration. [Sun et al., published 2026-03-31](https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2026.1768518/full).

A smaller randomized trial analyzed 21 students practicing four AI history-taking cases. Adding structured AI feedback improved human-rated clinical reasoning/history-taking scores; focusing questions did not improve significantly. Small sample size, German-language text interactions, and limited nonverbal fidelity constrain generalization. This supports testing feedback as an intervention, rather than assuming conversational realism alone produces learning. [Brügge et al., published 2024-11-28](https://link.springer.com/article/10.1186/s12909-024-06399-7).

**Proposed encounter loop:** brief the learner on role, objectives, available chart/actions, timer, and simulation limitations; run the ten-minute encounter; collect a short explanation of the learner's reasoning; debrief; retry with the same objectives. Keep emergency recognition and appropriate escalation within faculty-defined expectations. Do not reward completing a ten-minute script over responding appropriately to an urgent authored cue.

## Patient resistance, mood, and withheld information

The meeting's “grumpiness” idea can become an authoring control, but patient behavior needs an understandable context. SAMHSA's motivational-interviewing guidance treats ambivalence as normal and distinguishes statements favoring no change from interpersonal discord. It recommends collaborative, empathic communication rather than arguments or coercion. This guidance concerns substance-use counseling; applying its interaction principles to an ED education simulator is a design adaptation, not direct evidence for this product. [SAMHSA TIP 35, updated 2019, Chapter 3](https://www.ncbi.nlm.nih.gov/books/NBK571068/).

**Proposed authoring dimensions:** initial frustration, fear, readiness to discuss change, trust, health understanding, pain/discomfort, communication needs, and practical barriers. Faculty should define why a patient is guarded, what respectful approaches can change, and what remains stable. Mood must not alter diagnosis, vital signs, medication history, or other clinical truth. A cooperative patient can still disagree; respectful communication need not produce compliance or immediate disclosure. Avoid tying these behaviors to demographic stereotypes.

Patient nondisclosure is a real phenomenon, but “patients lie” is too broad a training frame. A primary online survey of two nonprobability samples totaling 4,510 respondents found self-reported withholding of relevant information; common explanations included anticipated judgment, embarrassment, and misunderstanding or disagreement with recommendations. These samples do not establish population prevalence or a method for identifying deception in an individual. [Levy et al., published online 2018-11-30](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2716996).

**Proposed case mechanism:** separate faculty-approved underlying facts from what the patient initially says, knows, misunderstands, or withholds. For every authored discrepancy, store the initial statement, the underlying fact, the motivation, the accessible clue, accepted clarification approaches, and the disclosure rule. Distinguish intentional withholding from poor recall, uncertainty, and misunderstanding. Ask students to clarify inconsistencies respectfully; do not infer dishonesty from gaze, facial expression, tone, or hesitation.

The notes' dentist and vitamin-brand questions are example prompts, not a clinical rule or diagnostic shortcut. Score whether a relevant follow-up produces useful information in the approved case. Do not require one exact wording, teach students to manipulate patients, or expect patients to know laboratory values that have never been disclosed to them. If the student had no accessible clue, feedback should not claim they should have detected a hidden inconsistency.

## Empathy, rapport, and clinical alliance

**Looking at an avatar's face should not be an empathy score.** The available evidence does not validate that proxy. A primary OSCE study of 56 students compared self-ratings, SP ratings, observer ratings, coded responses to emotional cues, and nonverbal behavior. Several SP/observer measures correlated with behavioral measures; students' self-perceived empathy did not correlate with the other perceived-empathy measures. This is a modest correlation study, not validation of automated webcam, gaze, sentiment, or avatar-based scoring. [Hepner et al., first online 2025-12-29; journal issue 2026-06](https://archive-ouverte.unige.ch/unige:190990).

Another primary OSCE study with 129 students found differences between examiner and SP CARE empathy ratings and unsatisfactory inter-rater agreement for some items. The practical implication is to calibrate raters and specify the assessment perspective, rather than advertise an “objective empathy score.” [Dufayet et al., first online 2024-01-29; journal issue 2024-09](https://pubmed.ncbi.nlm.nih.gov/38285021/).

**Proposed empathy evidence:** the learner notices an authored concern, acknowledges its meaning without assuming too much, asks for elaboration, checks understanding, and adapts their response. Face/voice animation can present emotional cues. The learner should also have a text or accessible equivalent. Any gaze telemetry would require separate validation and should not affect grades during the prototype.

Rapport can be represented by a simulated patient state, but its increase is not an independently measured learner outcome when the same rules cause the increase. Label it **simulated rapport**, expose the triggering turns and rule version, and report the student's observable actions separately. Initial mood and case difficulty affect the trajectory; comparing raw increases across unlike patients would be misleading.

For clinical alliance, a primary development study introduced SOMA to observe engagement, trust, and concordance about illness beliefs and treatment recommendations. Initial reliability evidence came from 33 consultations with veterans with medically unexplained symptoms. This provides a useful construct vocabulary, not a validated scoring model for undergraduate ten-minute ED avatar encounters. [Friedlander et al., first online 2019-12-16](https://journals.sagepub.com/doi/10.1177/0011000019891434); [published article from the authors' research group](https://www.mcandrewhealthlab.com/uploads/5/3/9/5/53951197/0011000019891434.pdf).

**Proposed alliance evidence:** invite participation, explore the patient's priorities, explain uncertainty, check the shared understanding of the problem, and negotiate an appropriate next step. Do not count agreement alone: informed refusal or a respectfully documented disagreement can be an appropriate outcome.

## Prototype rubric: formative and unvalidated

The following is a **custom draft**, not SEGUE, CARE, SOMA, an OSCE certification instrument, or a validated composite. SEGUE's original publication supports assessing concrete communication tasks and reported validity/reliability evidence in its studied contexts; an automated adaptation must establish its own validity. [Makoul, published 2001-10](https://pubmed.ncbi.nlm.nih.gov/11602365/).

| Domain | Observable evidence to review | Avoid rewarding |
| --- | --- | --- |
| Opening and agenda | Introduces role; invites the patient's concern; agrees on the encounter focus | Formulaic greeting alone |
| Relevant inquiry | Starts broadly when appropriate; follows clinically relevant cues; clarifies time course and context | Number of questions or one required phrase |
| Information reliability | Clarifies an accessible discrepancy; checks understanding; seeks permitted corroboration | Accusations or guessing a hidden fact |
| Response to emotion | Recognizes the cue; explores its meaning; acknowledges and adapts | Gaze, positive sentiment, or repeated canned reassurance |
| Partnership and autonomy | Elicits priorities/barriers; asks permission when appropriate; respects disagreement | Patient obedience or forced disclosure |
| Reasoning and uncertainty | Gives a brief evidence-based rationale; identifies missing information; updates interpretation | Merely naming the scripted diagnosis |
| Explanation and closure | Uses understandable language; checks comprehension; summarizes and states faculty-approved next steps | Unsupported reassurance or rushed closure |

For each applicable domain, use **0 = not demonstrated despite an opportunity; 1 = partial attempt; 2 = adequate for the objective; 3 = consistent and responsive to this patient's context**. Mark **not assessable** when no opportunity existed or the transcript/audio is unreliable; do not silently turn missing evidence into a zero. Preserve turn IDs, the observed behavior, rationale, and an uncertainty flag for every proposed rating. Report domains separately until weighting and composite interpretation have been tested. Handle faculty-defined critical errors as explicit review flags rather than letting a strong rapport score offset them.

Faculty-set goals should select two or three applicable behaviors and author enough opportunities to demonstrate them. The rubric cannot judge unobservable internal empathy or critical thinking directly; ask the learner to explain a decision and compare that explanation with the encounter evidence.

## Debrief and hard conversations

PEARLS is an original framework combining learner self-assessment, focused discussion, and directive feedback/teaching. It is a framework-development paper, not evidence that an autonomous LLM debrief is equivalent to a trained facilitator. [Eppich and Cheng, published 2015-04](https://pubmed.ncbi.nlm.nih.gov/25710312/). INACSL's official standards require a planned debriefing process and measurable learning objectives; the debriefing standard was revised in 2025. [INACSL standards, checked 2026-10-10](https://www.inacsl.org/healthcare-simulation-standards).

**Proposed LLM debrief:** ask for the learner's interpretation first; identify an effective moment; present one or two important missed opportunities; cite the exact turns and authored case evidence; explain the reasoning gap; offer a possible next question and a focused retry goal. Separate what happened, what the approved case expected, and an inferred explanation. Omission feedback needs an accessible clue and sufficient opportunity. An LLM may draft this feedback, but faculty must be able to inspect, correct, and challenge it. Keep coaching after the assessed encounter; offer explicit practice-mode hints separately.

Giving hard news is a suitable separate communication module with its own objectives. SPIKES describes preparation, eliciting understanding and information preferences, communicating knowledge, responding to emotion, and discussing strategy/summary. Its original report describes increased learner confidence and proposes continued assessment; this is not proof of competence or improved patient outcomes. [Baile et al., published 2000-08](https://pubmed.ncbi.nlm.nih.gov/10964998/). VitalTalk's official NURSE guidance supplies behavior-oriented approaches to responding to emotion. [VitalTalk guidance, publication date not stated; checked 2026-10-10](https://vitaltalk.org/responding-to-emotion-respecting/).

For a cancer-diagnosis exercise, faculty must author what is confirmed, what remains uncertain, and the learner's role. The model must not invent a definitive diagnosis, prognosis, or treatment plan. Use a content-aware prebrief, pause/stop option, and supportive debrief. A ten-minute practice segment can target part of the conversation; it should not imply that a complete real serious-news conversation must fit the timer.

## Validation plan before making outcome claims

1. **Content review:** clinical faculty and communication educators approve the facts, goals, disclosure rules, cues, expected responses, and rubric applicability for each case. Include an SP educator or patient partner when feasible.
2. **Behavior review:** test respectful and disrespectful approaches, paraphrases, interruptions, uncertain answers, refusals, and contradictory prompts. Confirm that facts remain stable and disclosures obey the authored policy.
3. **Scoring review:** have at least two calibrated human raters independently assess a varied transcript set, blinded to the automated ratings. Examine item agreement, score differences, missing evidence, and false feedback; do not rely only on correlation or use the patient model's own mood as ground truth.
4. **Fairness and access:** test accents, language variation, assistive access, and text versus speech. Check transcript errors and whether equivalent clinically appropriate behavior receives comparable feedback.
5. **Learning evaluation:** use an unseen human-SP or faculty-observed case before/after practice; include a comparator with matched time and feedback if claiming an advantage. Measure delayed retention separately from immediate satisfaction or confidence.
6. **Operational evaluation:** measure simultaneous-session capacity, completion, interruption handling, response latency, transcription failures, cost per completed encounter, and debrief usefulness. Technical feasibility and educational effectiveness are different results.

These are proposed evaluation steps. No validation participants, acceptance thresholds, learning gains, or clinical outcomes are claimed for CaseClimb by this note.
