# Agenda statechart: accountability by contract

Date: 2026-11-20. Site: majidbabaei.com (personal site). Status: proposed; for implementation by a coding agent in this repository.
Reference figure: `docs/superpowers/specs/2026-11-20-agenda-statechart-mockup.svg` (rendered PNG beside it). Coordinates below come from it.

> Repository note (2026-11-20): the mockup SVG/PNG were not supplied with this spec and are not in the repository. One identifying tool name of a review-stage manuscript in the *Variables* paragraph has been redacted, because this repository is public; it is on the `hidden` list in `tools/build-public.mjs`.

---

## Prompt for the coding agent

> Read this file in full, then implement it phase by phase (Phases 1–7). Work in `majidbabaei.com/` only; touch the lab repository only where Phase 6 says so. Follow `README.md`: facts come from the CV data (`assets/research-data.js`), generated files are never edited by hand, every builder has a `--check` mode, and `npm test` must pass. Two requirements outrank everything else: **(1) a first-time visitor must be able to read the figure in under a minute, and (2) the figure must be a well-formed UML state machine whose properties are checked automatically on every build.** Keep the manuscripts marked `"anonymous": true` anonymous everywhere: never write their titles, tool names, venues or co-authors into any file. Publish no number that is not already in the CV data or an existing news post. Stop after each phase, run its checks, and show me screenshots before moving on. Ask before changing any wording marked **(author decides)**.

---

## Why change the diagram

Today's commit `183f3d0` changed the hero to **"Accountability by contract for AI agents"**. It describes agent behaviour as *attributable, traceable, and correctable* and defines *Foundational Contracts* in a footnote. The agenda section directly below still tells the earlier story ("Closing the loop between humans and agentic AI"): two states, two arcs, and a centre that reads "the missing loop · EFFICIENT · EFFECTIVE". A visitor reads two different agendas one screen apart.

The current figure has three gaps:

1. **No contract and no accountability.** Neither word appears in the SVG, although the hero is built on both.
2. **No remedy.** The figure shows specification (down) and explanation (up), but accountability also means *containing and repairing* a mistake. That is the core of Heartness and of SSEVOH-DSL's withdrawal, and today it appears only in a hover tooltip.
3. **A statechart in name only.** The labels borrow UML's `event [guard] / action` notation, but no guard ever changes the path, and there is no initial pseudostate. An MDE reader will notice both.

## Design goals

| Goal | What it means here | How it is checked |
|---|---|---|
| **G1 Easy to understand** | After one look, a visitor can say: *people delegate under a contract, agents report with evidence, and violations are contained and sent back to a person.* | Readability budget (below), a one-sentence reading under the figure, and a hallway test (Phase 7). |
| **G2 Valid UML** | A well-formed UML state machine: initial pseudostate, states with entry behaviours and one state invariant, and transitions labelled `trigger [guard] / effect`. The contract is drawn as a UML *comment* (note), not as a fake state. | Well-formedness rules W1–W9, enforced by the builder. |
| **G3 Verifiable** | The figure's claims are properties of the model, checked by machine: the accountable person is always reachable, every violation is contained, containment always ends with the person, and the machine is deterministic. | Temporal properties V1–V6, checked by a small explicit-state model checker in `npm test`; SCXML export; optional SPIN cross-check. |
| **G4 Single source** | One model drives the horizontal SVG, the vertical SVG, the animation, the cards, the caption, the SCXML file and the static news figure. | `--check` mode. The generator first reproduces today's figure exactly. |

### Readability budget (G1)

- At most **3 states, 5 transitions, and 4 steps (dots) per arc**; only the two main arcs carry dots.
- Each transition has **one plain-language title** (one verb: *Delegate, Report, Contain, Re-admit, Escalate*) plus **one line of UML label**. The verb carries the story; the UML line carries the precision.
- Reading order is numbered ①–⑤, clockwise from the initial dot.
- Colour by role, used consistently: orange = delegation, teal = reporting, rose = containment, navy = the person.
- Secondary paths (④, ⑤) are thin and dotted; the main loop (①, ②) is thick and dashed, as today.
- No UML label longer than about 60 characters; nothing smaller than 10 px at a 390 px viewport.
- One plain-words sentence under the figure (copy in *Content*).

## The new state machine

Reference figure: `2026-11-20-agenda-statechart-mockup.png`.

### Variables

One integer variable, `tries ∈ {0, …, k}` with `k = 2`: the number of containments since the person last decided. It exists for one reason: without it, *Quarantine → ④ → Agentic AI → ③ → Quarantine* can repeat forever, and "every containment ends with the person" (V4) is false. The checker finds exactly this loop on the unbounded mutant. The bound is the same idea as [redacted: a review-stage tool]'s *k* resamples before escalation and Heartness's bounded revalidation, and it is a good talking point.

### States

| id | Name | Meta line | Behaviour | UML notes |
|---|---|---|---|---|
| `human` | Human | accountable · intent · concerns | `entry / decide; tries := 0` | target of the initial pseudostate |
| `ai` | Agentic AI | agents · teams · harness | `entry / plan; hand off; act` | "harness" signals self-evolving agents |
| `quarantine` | Quarantine | contained · kept in history | `entry / suspend everywhere` | state invariant `{inv: nothing exposed in use}`; dashed rose border |

The **initial pseudostate** (filled dot) points to Human: every run starts with the accountable person.

The **foundational contract** sits in the centre as a **UML comment** (a note with a folded corner), headed `«contract» context: every transition`, with the lines *foundational contract*, **BOUNDED · ATTRIBUTABLE · TRACEABLE · CORRECTABLE** and `assume · guarantee · evidence`. Drawing it as a note, not a state, is what keeps the figure valid: the contract is not a mode the system is in, it is the constraint every transition is checked against.

**(author decides)** The hero lists three properties (*attributable, traceable, correctable*); the note adds **bounded**, which is what "by contract" supplies. Either add "bounded" to the hero sentence, or remove it from the note. Do not ship two different lists (rule W9).

### Transitions

| # | id | From → To | Title | UML label (`trigger [guard] / effect`) | Stereotype | Style |
|---|---|---|---|---|---|---|
| ① | `bind` | Human → AI | Delegate | `delegate [concerns modeled] / model; specify; compose; verify` | «bounded» | orange, thick dashed |
| ② | `account` | AI → Human | Report | `report [contract holds] / trace; record; slice; explain` | «attributable, traceable» | teal, thick dashed |
| ③ | `withdraw` | AI → Quarantine | Contain | `report [contract violated] / withdraw closure; tries++` | «correctable» | rose, thick dashed |
| ④ | `revalidate` | Quarantine → AI | Re-admit | `[screen clean ∧ tries < k] / re-admit` (completion) | | rose, thin dotted |
| ⑤ | `escalate` | Quarantine → Human | Escalate | `[else] / explain affected set` (completion) | | navy, thin dotted |

Three design choices make the machine valid and checkable, not only drawn:

- **② and ③ share the trigger `report`**, with complementary guards (`contract holds` / `contract violated`). Every report has exactly one outcome, so the machine is deterministic and complete at Agentic AI.
- **④ and ⑤ are completion transitions** (no trigger; they fire when Quarantine's entry behaviour finishes), with guards `screen clean ∧ tries < k` and `else`. Quarantine therefore can never be a dead end, and after *k* containments it always escalates to the person.
- **The dots on an arc are exactly the steps of that transition's effect.** ① shows model, specify, compose, verify, and ② shows trace, record, slice, explain. Nothing on the figure is decoration without semantics; rule W7 enforces this.

### Step tooltips (hover and focus on each dot)

- ① **model**: safety, intent, correctness and organizational rules, stated at the level people reason about · SSEVOH-DSL
- ① **specify**: what each agent, guardrail and hand-off may assume and must guarantee · TINT, SSEVOH-DSL
- ① **compose**: checked assembly of agent teams and the state they share · AutoM2M, Safe Coordination
- ① **verify**: does the composed team still meet its concerns? · TINT, Safe Coordination
- ② **trace**: transcripts, tool calls and executions, abundant but unreadable at scale · TAAF
- ② **record**: which agent handed what to whom, and which version, approval and context produced a behaviour · Heartness, [anonymous for review]
- ② **slice**: the few components whose interaction explains a symptom · Agent Slicing
- ② **explain**: why an objective was or was not achieved, in terms people can check · TAAF, Agent Slicing

Tooltips on the ③④⑤ labels:

- ③ When a lesson, skill or hand-off turns out to be wrong, everything recorded as exposed to it is suspended in every deployment · Heartness, SSEVOH-DSL
- ④ Suspended items return only after a fresh check, as new versions, and only a bounded number of times · Heartness
- ⑤ The responsible person sees exactly what was affected and why, and decides what changes in the contract · Heartness, Agent Slicing

**Anonymity rule.** `[anonymous for review]` stays exactly as it is today. If attributing "record" to an anonymous manuscript would itself identify the paper while it is under review, drop that attribution **(author decides)**.

### Runs (what the animated token does)

- **Run A, accountable** (most passes): initial → Human → ① → Agentic AI → ② → Human.
- **Run B, contained** (every third pass): Human → ① → Agentic AI → ③ → Quarantine (the invariant line lights) → ⑤ → Human. On alternate contained passes, take ④ → Agentic AI → ② → Human instead, so both exits from Quarantine are seen over time.
- The header counter reads `pass 03 · contained` during a Run B pass and `pass 04` otherwise.
- Every run is a **valid trace of the model** (V6), so the animation can never show a move the state machine forbids.
- Reduced motion: no token, all dots shown "on", and the counter reads `3 states · 5 transitions · 8 steps`.

### Geometry (horizontal, `viewBox 0 0 1000 740`; tune by screenshot)

- Initial dot `circle(146,172,r=8)` → Human. Human `rect(30,224,232,150)`, Agentic AI `rect(738,224,232,150)`, Quarantine `rect(384,566,232,162)`.
- ① `M262 251 C 390 99, 610 99, 738 251`, label box centred at `(500, 71)`, width 470.
- ② `M738 347 C 610 499, 390 499, 262 347`, label box centred at `(500, 503)`, width 430.
- ③ `M905 364 C 930 514, 780 641, 618 641`; ④ `M600 579 C 700 579, 800 484, 812 374`; ⑤ `M384 641 C 230 634, 80 514, 110 366`.
- Note (comment) `M292 248 H688 L708 268 V356 H292 Z`, with the folded corner at the top right.
- The ③ and ⑤ label blocks sit in the bottom corners; the ④ label sits left of its arc, between the ② box and Quarantine.

Vertical (mobile), `viewBox 0 0 580 780`: initial dot, Human at the top, the note, Agentic AI, and Quarantine at the bottom. ③ runs AI → Quarantine on the right, and ⑤ runs Quarantine → Human as a long dotted arc on the left. Draw ④ as a short dotted arc on the inner right, labelled only `④ Re-admit`.

## Model: `data/agenda.statechart.json`

The model follows the UML state-machine metamodel closely enough to export to SCXML (W3C) without loss.

```json
{
  "label": "agenda.statechart",
  "heading": { "num": "§ 01 — Research agenda", "h2": "Accountability by <em>contract</em> for <em>agentic AI</em>" },
  "initial": "human",
  "variables": { "tries": { "min": 0, "max": 2, "init": 0 } },
  "constants": { "k": 2 },
  "comment": { "stereotype": "contract", "context": "every transition", "name": "foundational contract",
               "props": ["bounded", "attributable", "traceable", "correctable"], "line": "assume · guarantee · evidence" },
  "guards": {
    "concernsModeled": { "text": "concerns modeled", "env": true },
    "contractHolds": { "text": "contract holds", "env": true, "complement": "contractViolated" },
    "contractViolated": { "text": "contract violated", "env": true, "complement": "contractHolds" },
    "screenClean": { "text": "screen clean", "env": true },
    "canRetry": { "text": "tries < k", "expr": "tries < k" }
  },
  "states": [
    { "id": "human", "name": "Human", "meta": "accountable · intent · concerns", "entry": ["decide", "tries := 0"], "box": [30, 224, 232, 150] },
    { "id": "ai", "name": "Agentic AI", "meta": "agents · teams · harness", "entry": ["plan", "hand off", "act"], "box": [738, 224, 232, 150] },
    { "id": "quarantine", "name": "Quarantine", "meta": "contained · kept in history", "entry": ["suspend everywhere"],
      "invariant": "nothing exposed in use", "box": [384, 566, 232, 162], "style": "dashed" }
  ],
  "transitions": [
    { "n": 1, "id": "bind", "title": "Delegate", "stereotype": "bounded", "from": "human", "to": "ai",
      "trigger": "delegate", "guard": ["concernsModeled"], "effect": ["model", "specify", "compose", "verify"],
      "tone": "orange", "path": [[262, 251], [390, 99], [610, 99], [738, 251]],
      "steps": { "model": { "d": "…", "refs": ["SSEVOH-DSL"] } } },
    { "n": 2, "id": "account", "from": "ai", "to": "human", "trigger": "report", "guard": ["contractHolds"], "effect": ["trace", "record", "slice", "explain"] },
    { "n": 3, "id": "withdraw", "from": "ai", "to": "quarantine", "trigger": "report", "guard": ["contractViolated"], "effect": ["withdraw closure", "tries++"] },
    { "n": 4, "id": "revalidate", "from": "quarantine", "to": "ai", "trigger": null, "guard": ["screenClean", "canRetry"], "effect": ["re-admit"] },
    { "n": 5, "id": "escalate", "from": "quarantine", "to": "human", "trigger": null, "guard": "else", "effect": ["explain affected set"] }
  ],
  "runs": [
    { "id": "accountable", "path": ["bind", "account"] },
    { "id": "contained", "every": 3, "path": ["bind", "withdraw", "escalate"], "alt": ["bind", "withdraw", "revalidate", "account"] }
  ],
  "cards": [ { "t": "bind", "kicker": "01 · Delegate", "tag": "bounded", "h3": "…", "body": "…", "chips": ["SSEVOH-DSL", "TINT", "Safe Coordination", "AutoM2M", "anonymous-review-1"] } ]
}
```

Guards marked `env: true` are decided by the environment (the checker branches over both values); `expr` guards are evaluated on variables. A guard list is a conjunction. `refs` and `chips` are project names or publication-title prefixes, exactly as the existing `data-find` chips use them, or the keys `anonymous-review-1` / `anonymous-review-2`.

## Validity and verification (G2, G3)

All checks live in `tools/agenda-model.mjs`. The builder runs them, and `tools/agenda.test.mjs` runs them against the real model and against one seeded faulty model (mutant) per rule.

### Well-formedness rules (UML constraints, as the builder checks them)

- **W1** Exactly one initial pseudostate, with exactly one outgoing transition, without trigger or guard, to a declared state.
- **W2** Every transition's `from` and `to` name declared states; ids are unique.
- **W3** Every guard reference names a declared guard, or is `else`; at most one `else` per (state, trigger).
- **W4** **Determinism:** for each state and trigger (completion counts as a trigger), no two transitions can be enabled at once. Complementary env-guards, or `else`, separate them.
- **W5** **Completeness where it matters:** (a) completion transitions leaving a state cover every guard valuation (an `else` or a complementary pair); otherwise the state could get stuck. (b) Triggered transitions whose guards declare a `complement` cover both values. This is what makes every report end in ② or ③, and every Quarantine stay end in ④ or ⑤. A triggered transition with a plain guard, such as ①'s `[concerns modeled]`, follows standard UML semantics: if the guard is false, the event is discarded and the machine stays in Human.
- **W6** Completion transitions (`trigger: null`) leave only states that have an entry behaviour: in UML, the completion event fires when that behaviour finishes.
- **W7** Every dot drawn on an arc is a step of that transition's `effect`, in the same order. Variable updates (`tries++`) are effects but are not drawn as dots.
- **W8** Every `refs`/`chips` entry resolves to `R.projects`, a title prefix in `R.published`/`R.submitted`, or an anonymous key. No anonymous title, tool name or venue, and no term from the git-ignored deny-list `tools/agenda-private.txt`, appears in the model or in any generated output.
- **W9** The comment's `props` equal the property list in the hero sentence of `index.html` (after the author's decision above). Status words in card bodies agree with the CV data, and numbers in card bodies already appear in the CV data or an existing news post. Today only Agent Slicing's 36.1% and 99.9% qualify; this blocks unpublished Heartness numbers.

### Temporal properties (checked by machine)

The checker unfolds the model into a finite Kripke structure. Its nodes are (state, `tries`, last transition), with branching over every env-guard valuation. Events are assumed to arrive: Agentic AI's only successors are the two outcomes of `report`. The reference prototype `2026-11-20-agenda-checker-prototype.py` (beside this file; port it to `tools/agenda-model.mjs`) reaches **7 nodes** for the model and checks V1–V5 in milliseconds. Each property is stated in CTL, together with the plain-language claim it backs:

| ID | CTL | What it says about the agenda |
|---|---|---|
| **V1** | `AG EF human` | From anywhere, the accountable person can always be reached: **humans stay accountable**. |
| **V2** | `AG (last = withdraw → quarantine)` | **Every violation is contained**: a violated report always lands in Quarantine, never anywhere else. |
| **V3** | `AG (quarantine → EX ¬quarantine) ∧ AG ¬(quarantine ∧ deadlock)` | **Quarantine is never a trap**: it is always left, by re-admission or escalation. |
| **V4** | `AG (quarantine → AF human)` | **Every containment ends with the person**, on every path, without fairness assumptions. This holds only because of the `tries < k` bound; the unbounded mutant must fail with the cycle Quarantine → AI → Quarantine as its counterexample. |
| **V5** | `EF ai ∧ EF quarantine` from the initial state, plus `AG EF ai` | Every state is reachable and stays reachable: **no dead parts of the figure**. |
| **V6** | each `runs[*].path` (and `alt`) is a path from `initial` that returns to `human` with all guards satisfiable | **The animation is a valid trace**: the token never shows a move the machine forbids. |

V1–V6 are what the figure claims in pictures. The test turns them into claims the model actually satisfies. For each property, a seeded mutant must fail, for example:

- deleting ④ and ⑤ breaks V1, V3, V4 and V5;
- pointing ③ at Human breaks V2 and V5;
- dropping `canRetry` breaks V4 only;
- deleting ③ breaks V2 and V5.

All four results were confirmed with the prototype: the model passes V1–V5, and each mutant fails exactly the properties listed above.

**Counterexamples are printed as runs** (`human -bind-> ai -withdraw-> quarantine -revalidate-> ai …`), in the same format as `runs`. They can therefore be pasted into the model and animated: the same witness-replay idea as in Heartness.

### Standard export and cross-check

- `tools/build-agenda.mjs` also writes **`assets/agenda.scxml`**: the model in W3C SCXML, with `<datamodel>` for `tries`, `onentry`, and transitions with `event`/`cond`. Env-guards become event payload conditions; the invariant and the contract are XML comments. This makes the model readable by standard statechart tools. Link it from the figure as "model (SCXML)". Optionally, validate it in CI against the W3C SCXML XSD, vendored in `tools/schema/`, with `xmllint`.
- **(optional)** `--promela` writes `tools/out/agenda.pml` and checks V1–V4 with SPIN. That gives the same *two independent encodings* discipline as Heartness (BFS ∥ SPIN), so the figure itself becomes a small worked example of your method.

## Build (`tools/build-agenda.mjs`)

The builder reads the model and runs W1–W9 and V1–V6; any violation fails the build. It then writes:

- the `<figure class="loop">` block and the cards in `index.html`, between `<!-- BEGIN GENERATED AGENDA -->` / `<!-- END GENERATED AGENDA -->` markers (add the markers once, by hand, around the current block);
- `assets/agenda-data.js` (`window.AGENDA`: transitions, steps, runs, counts), replacing the hard-coded `CONCEPTS` in `site.js`;
- `assets/img/agenda-statechart.svg`, a static figure (all dots on, no token) for news posts and social images;
- `assets/agenda.scxml`;
- the `<figcaption>`, generated from the model so the accessible description always matches the picture.

It also has a `--check` mode, which fails when any output is stale.

## Runtime (`assets/site.js`)

Generalize the existing code; do not rewrite it.

- Look up arcs by transition id (`data-arc="bind"`, and so on) instead of `down`/`up`. Dots come from the drawable `effect` steps.
- Build each pass's phase list from `runs`. Pass *p* uses `contained` when `p % every === every - 1`, alternating `path`/`alt`; every other pass uses `accountable`.
- Dwelling in Quarantine lights its entry line and its invariant, and the counter shows `· contained`.
- Highlighting generalizes from `hl-down`/`hl-up` to `hl-<id>`. Cards and arcs highlight each other, as today.
- Keep the existing safeguards: IntersectionObserver pause, `visibilitychange`, `Motion.reduced`, `ResizeObserver` first layout, and print hiding.
- On each new pass, the token starts at the initial dot and moves into Human (300 ms) before ①.

## Styles (`assets/style.css`)

- Move `--rose` from `calendar.css` into the site tokens (light and dark) and reuse it.
- Quarantine: `stroke: var(--rose); stroke-dasharray: 7 5`. Add `.arc-r`/`.tok-r` matching `.arc-o`/`.tok-o`. ④ and ⑤ use `stroke-width: 2; stroke-dasharray: 3 6`.
- Note: white (card) fill, navy 1.4 px border, folded corner, and the `«contract»` line in the muted mono style. Check the contrast of the four-property line in dark mode.

## Content: drop-in copy

**Section head** (`index.html`):

- Kicker: `§ 01 — Research agenda`
- H2: `Accountability by <em>contract</em> for <em>agentic AI</em>`
- Lead: *A computer cannot be punished, and it does not need to be. What makes a system accountable in practice is a set of mechanisms: we know what it was allowed to do, which component did what and from which evidence, and how to contain and repair a mistake. My research engineers these mechanisms for AI agents with model-driven engineering, so that the people responsible for agentic systems can actually exercise that responsibility.*

**One-sentence reading, directly under the figure** (plain text):

> *Read it clockwise: a person delegates work under a contract (①); agents report back with evidence (②); if the evidence shows the contract was violated, the affected work is quarantined (③) and either re-checked and re-admitted (④) or explained to the person, who decides what happens next (⑤).*

**Cards** (four; the fourth is the dark card):

1. `01 · Delegate` · `bounded`, **Delegating with a contract.** Concerns such as safety, intent and organizational rules usually reach an agent as prose. I turn them into foundational contracts: models of what each agent, guardrail and hand-off may assume and must guarantee, composed and checked before the team runs. Chips: SSEVOH-DSL · submitted to TSE, TINT, Safe Coordination, AutoM2M, [anonymous for review].
2. `02 · Report` · `attributable · traceable`, **Accounting for what agents did.** Transcripts and tool logs are abundant but unreadable at scale. I record hand-offs and provenance while agents work, and abstract them into slices and explanations, so a person can see which agent produced what, from which evidence, and why an objective was or was not met. Chips: Agent Slicing, [anonymous for review], TAAF · ICSE 2026.
3. `03 · Contain` · `correctable`, **Containing what went wrong.** When a learned lesson, a skill or a hand-off turns out to be wrong, deleting it is not enough: its effects have already spread into other artifacts and deployments. Recorded lineage finds everything it touched and suspends it everywhere. It is re-admitted only after a fresh check, a bounded number of times, and otherwise explained to the person responsible. Chips: Heartness, SSEVOH-DSL.
4. Dark card, `04 · The contract` · `checked, not just drawn`, **One object, checked in both directions.** Specifications without evidence cannot tell us whether they were honored; evidence without specifications gives us nothing to check against. A foundational contract holds both. This figure follows its own rule: it is generated from a state-machine model, and on every build a model checker verifies that a person can always be reached and that every violation is contained and ends with a person. Links: *Read the full agenda →* · *Model (SCXML)*.

**Navigation** (`tools/chrome.mjs`, then `node tools/sync-nav.mjs`): change the Agenda description to `Accountability by contract for agentic AI`.

**News (author decides).** Do not rewrite `2026-11-10-closing-the-loop.md`: it is dated and accurately records the agenda on that date. Recommended: add `news/posts/2026-11-YY-accountability-by-contract.md` explaining the revised figure, with this outline:

1. What "accountable" means here.
2. The four properties.
3. Why a third state, and why the retry bound.
4. How the figure is itself a checked model, with V1–V6 in plain words.

Point the dark card at the new post, and add one "Update:" line to the old post linking forward. If the post mentions the IBM page, call it "attributed to an internal IBM training from 1979". If it mentions Sapolsky, say that the figure borrows his *forward-looking, minimal-constraint* quarantine idea, not his conclusions about free will. Social image: export the static SVG to a 1200 × 627 PNG at `assets/img/news/agenda-statechart.png`.

## Phases and checks

| Phase | Work | Done when |
|---|---|---|
| 1 Model + checker | Re-express **today's** figure as a model (2 states, 2 transitions); implement W1–W9 and V1–V6 in `tools/agenda-model.mjs`; add `tools/agenda.test.mjs` with one seeded mutant per rule. | Today's figure fails exactly the rules it should (W1: no initial pseudostate; W4/W5: guards are not complementary), which documents why the change is needed. The new model passes everything, and every mutant fails its rule with a readable counterexample. |
| 2 Generator | `tools/build-agenda.mjs` reproduces today's figure from the old-figure model, diff-clean after whitespace normalization. Rules that today's figure fails are reported as warnings in this phase only. | `--check` passes on the unchanged page, so later visual changes come from the model, not from rendering bugs. |
| 3 Runtime | `site.js` reads `window.AGENDA`, with a scheduler driven by runs. | The old figure animates exactly as before. |
| 4 New model + styles | Switch to the 3-state model; add the initial dot, the note, and the `--rose` styles; tune the geometry. | Screenshots at 1280 / 820 / 390 px, light and dark, and reduced motion: no overlaps, the token follows the arcs, `pass 03 · contained` appears. W1–W9 and V1–V6 pass as errors (no longer warnings). |
| 5 Content | Heading, lead, reading sentence, four cards, nav, figcaption, SCXML link, optional news post + PNG. | Copy matches this spec; `npm test` and every `--check` pass. |
| 6 Integration | `package.json`: `build:agenda`, `check:agenda`. In `.github/workflows/static.yml`, run `node tools/build-agenda.mjs --check` first. `tools/build-public.mjs` copies the SVG, PNG and SCXML. README section "Update the agenda figure". In the lab repo, `scripts/sync-personal-site.mjs` runs and checks the builder, and `CHANGELOG.md`/`AGENTS.md` record it. | CI is green on a PR. |
| 7 Verification | **Hallway test:** show the figure for one minute to three people who do not know the work (for example, two students and one colleague outside SE), and ask each to retell it in one sentence. Pass if all three mention delegation, reporting and containment. Also: a11y (every dot and label focusable, tooltips readable, figcaption generated), dark-mode contrast, a grep of `_site/` for deny-list terms, and Lighthouse accessibility at or above the current score. | Checklist ticked; screenshots and the three sentences attached to the PR. |

## Risks

- **Double-anonymous review.** The biggest risk is leaking an anonymous manuscript through a tooltip, chip or alt text. W8 checks the model and the outputs, and CI greps `_site/`.
- **Overclaiming.** Heartness is "on-going" in the CV data. Its live-study numbers stay off the site until the CV or a news post states them (W9).
- **Too busy to read (G1).** Three states and five transitions is the budget ceiling. If the hallway test fails, drop ④ first: keep re-admission in ③'s tooltip, make ⑤ the only (unguarded) exit from Quarantine, and remove `tries`. W4/W5 and V1–V4 still hold, and V4 then holds trivially.
- **"Valid" but not meaningful.** A model checker proves only what the model says. The card copy must not claim more than V1–V6. In particular, the figure states the *design* of the accountability loop, not empirical results.
- **Hero and figure drifting apart again.** W9 ties the note's properties to the hero sentence.
