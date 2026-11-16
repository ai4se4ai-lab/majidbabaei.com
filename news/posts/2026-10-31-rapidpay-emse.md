---
title: Which TODO should you fix next? Follow the chain with RapidPay
subtitle: An autonomous shuttle, a delayed sensor frame, and three deferred fixes show why technical debt must be understood across the code it connects.
date: 2026-10-31
tags: [Publications, Software evidence]
summary: Accepted to Empirical Software Engineering and to appear, RapidPay connects technical-debt comments through code dependencies. An illustrative autonomous vehicle scenario explains its ripple scoring, commit-aware recommendations, and findings across 10 open-source projects.
cover: /assets/img/news/rapidpay-overview.png
coverAlt: RapidPay architecture connecting developer comments and repository history to debt detection, dependency chains, ripple scoring, and commit-aware recommendations.
---

Imagine an autonomous shuttle approaching a pedestrian crossing in a simulation. A person steps into its path. A delayed sensor frame reaches the perception software, where a temporary workaround labels it with its arrival time. The obstacle tracker assumes measurements arrive at regular intervals. The braking planner assumes the resulting obstacle positions are current. Together, those assumptions could make the planner act on an outdated estimate of the pedestrian's position.

Each shortcut has a comment somewhere in the repository. Now an engineer is changing the sensor interface. Is fixing the timestamp enough? Which assumptions in tracking and planning need to be reviewed with it? A list of three TODOs gives the engineer starting points. The dependencies between them explain why the change needs a wider view.

This is the maintenance problem behind **RapidPay**. Our paper, *RapidPay: Identifying and prioritizing self-admitted technical debt chains for effective debt management in software systems*, has been **accepted to Empirical Software Engineering** and is **to appear**.

The authors are M. Babaei, N. Ezzati-Jivan, F. Hendijani Fard, and A. Hamou-Lhadj.

## The problem hidden in a TODO list

Developers often leave an explanation when they accept a shortcut to get something working. A comment might acknowledge a temporary implementation, a missing safeguard, or code that needs refactoring. Researchers call these admissions **self-admitted technical debt**, or **SATD**.

Such comments preserve valuable knowledge. They tell a future maintainer where an earlier developer saw a compromise. But a repository-wide search can produce a long list of comments with very little guidance about the next change.

A comment's wording gives only part of the picture. The surrounding function may call another debt-bearing function, read shared state, or control whether another component runs. Following those relationships can reveal several deferred fixes that a developer should consider together. A small-looking change may require coordinating assumptions across files.

RapidPay asks three connected questions. **Which debt items are related? Which have the greatest structural reach? When does active development create a practical opportunity to address them?**

## Three shortcuts on the path to a braking decision

The shuttle is a constructed example for explaining RapidPay. Its code, comments, and possible consequences are illustrative. The evaluation later in this article reports results from the paper's open-source projects.

| Location | Developer's admission | Why it matters during a sensor-interface change |
| --- | --- | --- |
| `sensor_ingest.cpp` | `TODO preserve sensor capture timestamps` | The adapter currently labels measurements with the time they arrive, hiding transport delay. |
| `obstacle_tracker.cpp` | `FIXME prediction assumes a fixed measurement interval` | The tracker updates obstacle positions using a constant time step, even when frames arrive irregularly. |
| `braking_planner.cpp` | `HACK assume incoming obstacle tracks are current` | The planner uses those positions without accounting for the age of the underlying observations. |

Preserving the capture timestamp lets the system represent when an observation was made. That change also raises questions for the code consuming it. Does the tracker use the elapsed time between observations? Does it carry timing information into the tracks it produces? How does the planner respond when that information indicates an old observation?

In this scenario, sensor ingestion defines measurement data consumed by tracking, and tracking defines obstacle data consumed by planning. Those **data dependencies** connect the three admissions of debt. RapidPay uses relationships like these to assemble a *debt chain*. Despite the name, a chain can branch into a network of connected items.

Membership in that chain records structural reachability through code dependencies. It gives a maintainer evidence about where to investigate possible interactions. Establishing the actual behavior still requires inspecting the code and its tests.

## How RapidPay builds the picture

RapidPay combines four stages. Each stage adds information needed for the next decision, from recognizing an admission of debt to identifying an opportunity to act on it.

### 1. Find the admissions of debt

**SATD Instance Detection (SID)** starts with an inexpensive lexical filter. It looks for markers such as `TODO`, `FIXME`, and `HACK`, along with phrases such as “temporary solution” and “needs refactoring.” An LLM then classifies the candidate comments and supplies a confidence score used for filtering.

This second pass helps interpret what a comment is admitting. A request to add a README link and an admission that sensor timestamps discard measurement age describe different maintenance concerns, even if both begin with `TODO`. The approach also considers debt expressed through natural-language phrases beyond the familiar markers.

The initial filter defines which comments reach the LLM. Its coverage therefore affects what the rest of the pipeline can discover. In the supplied approach, the classifier uses zero-shot prompting with GPT-4o.

### 2. Connect the code behind the comments

**Inter-SATD Relationship Discovery (IRD)** associates detected comments with their enclosing code entities, such as functions, classes, or modules. Static analysis then looks for four kinds of dependency.

- **Calls** connect code that invokes other code.
- **Data dependencies** connect definitions of values with code that uses them.
- **Control dependencies** connect decisions with the execution they govern.
- **Module dependencies** connect importing or otherwise syntactically dependent modules.

RapidPay searches within a bounded dependency scope, using five hops by default. It gives relationships type-specific weights adjusted to the project's coupling and complexity, then constructs a directed dependency graph. Its chain-construction and visualization layer groups connected debt-bearing entities into chains, using connectivity with edge direction ignored for grouping.

In our shuttle scenario, this gives the engineer a way to inspect the path from sensor timestamps through obstacle tracking to the braking planner. Even when the comments live in different files, the data connecting their code entities makes the relationship visible. The graph retains dependency direction for the impact analysis that follows.

### 3. Estimate how widely a change could ripple

The **SATD Impact Ripple (SIR)** score summarizes an item's position in that graph. It combines three normalized structural signals.

- **Weighted fanout** measures the strength of its outgoing connections to other debt-bearing entities.
- **Weighted chain length** measures how far a dependency path can extend from it.
- **Weighted reachability** measures the wider set of debt-bearing entities reachable from it, accounting for connection strength.

Together, these signals give higher priority to items with greater potential structural influence. In the shuttle example, the timestamp item could receive a higher score if its outgoing dependencies reach the tracking and planning items. Its actual score would depend on the extracted graph and the rest of the project.

SIR is a relative structural score. In a vehicle project, engineers would interpret it alongside hazard analysis and the safety requirements for perception and braking. A planner with few graph connections can still have a critical role in vehicle behavior.

RapidPay also derives a soft effort signal from repository history, combining the time between SATD-touching commits with the number of files modified. That signal helps identify potentially manageable fixes when impact scores are similar. The timing proxy can include scheduling and review delays, so its interpretation requires care.

### 4. Bring the recommendation into today's work

**Commit-Aware Insight Generation (CAIG)** adds development context. It looks for recent changes to the debt-bearing code or its graph neighbors, and considers contributors' previous work in the relevant files.

Suppose your latest commit updates the sensor interface to retain capture timestamps. RapidPay can use that activity to raise relevant debt in the tracking and planning code. The engineer is already reviewing the timing data, and the graph identifies consumers whose assumptions may need to be revisited in the same change.

The final ranking combines ripple impact, commit relevance, historical effort, and an LLM assessment of fix potential. For candidates assessed as having high or partial fix potential, another prompt generates an ordered remediation plan using recent changes and connected debt items.

For our illustrative shuttle, a proposed plan could ask the engineer to trace capture timestamps through the pipeline, review the tracker's time-step assumption, and examine the planner's handling of observation age. It could also identify simulation cases with delayed and irregular frames for the team to test against its timing and safety requirements. These steps illustrate the kind of coordinated maintenance plan the approach aims to support. The engineering team would assess the proposal against the implementation and its safety process.

> A useful recommendation connects the deferred fix, the code it can affect, and the change a developer is making today.

## What the study found

We evaluated RapidPay across **10 open-source projects**. It achieved average SATD-detection precision of **0.90**, recall of **0.89**, and F1 of **0.90**, outperforming four baselines in the reported study. The analysis identified **742 distinct SATD chains**.

Detection is the first question. To examine whether the graph and development context help with prioritization, we replayed **18 months of post-snapshot commit history** across the projects and compared recommendations with the debt maintainers subsequently addressed.

**Hit@5** measures how often the debt item actually addressed appears within the top five recommendations. **Mean reciprocal rank (MRR)** rewards placing that item nearer the top, using the reciprocal of its rank and averaging across cases.

| Evaluation question | Reported result | Interpretation |
| --- | --- | --- |
| Does structural ranking help identify the next addressed item? | SIR reached Hit@5 of **0.48**, versus **0.29** for the reported baseline, with MRR of **0.33**. Hit@1 rose from **0.09** to **0.18**. | The graph supplied information associated with later maintenance choices. |
| Do chain members tend to be addressed close together? | Linked items were co-addressed within **30 days** at **3.2 times** the rate of random, unlinked pairs. | Chain membership captured relationships relevant to coordinated maintenance. |
| Does development context improve the ranking? | Full CAIG reached Hit@5 of **0.61** and MRR of **0.42**. | Adding context improved Hit@5 by **13 percentage points** over SIR alone. |
| How often did a recommendation precede the recorded fix? | **63%** of eventually resolved SATD appeared in the top five at commits before maintainers addressed it. | The replay identified opportunities to surface debt earlier. |

These retrospective findings measure alignment with historical maintenance activity. Measuring effects on developer effort, repayment speed, and software quality would require a prospective evaluation in which developers use the recommendations. The reported co-addressing result also concerns maintenance association within structurally connected groups.

## Why researchers should follow the chain

RapidPay brings comment interpretation, program structure, and repository activity into one prioritization process. Each supplies a different part of the maintenance decision. Comments express a known compromise, dependencies reveal possible interactions, and commits indicate where attention is already concentrated.

That combination opens concrete research questions. How sensitive are rankings to dependency scope and graph weights? How much debt does the lexical filter leave undiscovered? How well do historical time and file counts represent remediation effort? How do maintainers assess the usefulness and correctness of generated plans?

Return to the engineer updating the shuttle's sensor interface. The timestamp comment identifies a local compromise. Following its dependencies brings the tracker's timing assumption and the planner's freshness assumption into the same review. The research challenge is to make that guidance accurate, timely, and worth the engineer's attention when a change crosses several components.

## Read the implementation and research

- [Browse the RapidPay implementation and replication package](https://github.com/ai4se4ai-lab/RapidPay)
- [View the RapidPay project and release record](/projects/rapidpay/)
- [Open the architecture figure as a PDF](/assets/img/news/rapidpay-overview.pdf)

The technical description and reported results in this article follow the author-supplied manuscript material. The publication status follows the CV record, which lists the paper as accepted and to appear in *Empirical Software Engineering*.
