---
title: Which TODO should you fix next? Follow the chain with RapidPay
subtitle: A checkout retry, a shared payment state, and three deferred fixes explain how RapidPay connects technical debt to the work happening now.
date: 2026-10-31
tags: [Publications, Software evidence]
summary: Accepted to Empirical Software Engineering and to appear, RapidPay connects technical-debt comments through code dependencies. A checkout example explains its ripple scoring, commit-aware recommendations, and findings across 10 open-source projects.
cover: /assets/img/news/rapidpay-overview.png
coverAlt: RapidPay architecture connecting developer comments and repository history to debt detection, dependency chains, ripple scoring, and commit-aware recommendations.
---

A customer clicks **Pay**. The payment service takes too long to respond, so the checkout retries. Somewhere in the code, a developer has left a comment asking for better duplicate-request handling. Elsewhere, another comment admits that payment status is stored too loosely. A third flags a shortcut in receipt generation.

You have been asked to improve checkout retries. Which of those comments belongs in your change? How far will the fix reach? And which deferred improvement is worth tackling while you already have the code open?

This is the maintenance problem behind **RapidPay**. Our paper, *RapidPay: Identifying and prioritizing self-admitted technical debt chains for effective debt management in software systems*, has been **accepted to Empirical Software Engineering** and is **to appear**.

The authors are M. Babaei, N. Ezzati-Jivan, F. Hendijani Fard, and A. Hamou-Lhadj.

## The problem hidden in a TODO list

Developers often leave an explanation when they accept a shortcut to get something working. A comment might acknowledge a temporary implementation, a missing safeguard, or code that needs refactoring. Researchers call these admissions **self-admitted technical debt**, or **SATD**.

Such comments preserve valuable knowledge. They tell a future maintainer where an earlier developer saw a compromise. But a repository-wide search can produce a long list of comments with very little guidance about the next change.

A comment's wording gives only part of the picture. The surrounding function may call another debt-bearing function, read shared state, or control whether another component runs. Following those relationships can reveal several deferred fixes that a developer should consider together. A small-looking change may require coordinating assumptions across files.

RapidPay asks three connected questions. **Which debt items are related? Which have the greatest structural reach? When does active development create a practical opportunity to address them?**

## A checkout example you can follow

Consider an illustrative online shop with the following comments. The scenario is constructed to explain the approach. The study results later in this article come from open-source repositories.

| Location | Developer's admission | Why it matters during a retry change |
| --- | --- | --- |
| `checkout.py` | `TODO prevent duplicate payment attempts on retry` | The checkout calls the payment routine again after a timeout. |
| `payments.py` | `FIXME replace shared last_payment_status with per-order state` | The payment routine writes state that receipt generation also reads. |
| `receipts.py` | `HACK receipt assumes the latest payment status belongs to this order` | Receipt generation relies on an assumption that a state change would affect. |

Reading the first comment naturally raises a question about repeated requests. Following the code raises another question about how an order's payment result is represented. Following the data reaches the receipt logic. A developer now has a reason to inspect all three locations before deciding on the scope of a fix.

The code supplies the connections. Checkout **calls** payment handling, and payment handling supplies **data** used by receipts. RapidPay uses relationships like these to assemble a *debt chain*. Despite the name, a chain can branch into a network of connected items.

Membership in that chain records structural reachability through code dependencies. It gives a maintainer evidence about where to investigate possible interactions. Establishing the actual behavior still requires inspecting the code and its tests.

## How RapidPay builds the picture

RapidPay combines four stages. Each stage adds information needed for the next decision, from recognizing an admission of debt to identifying an opportunity to act on it.

### 1. Find the admissions of debt

**SATD Instance Detection (SID)** starts with an inexpensive lexical filter. It looks for markers such as `TODO`, `FIXME`, and `HACK`, along with phrases such as “temporary solution” and “needs refactoring.” An LLM then classifies the candidate comments and supplies a confidence score used for filtering.

This second pass helps interpret what a comment is admitting. A request to add a README link and an admission that payment state is shared incorrectly describe different maintenance concerns, even if both begin with `TODO`. The approach also considers debt expressed through natural-language phrases beyond the familiar markers.

The initial filter defines which comments reach the LLM. Its coverage therefore affects what the rest of the pipeline can discover. In the supplied approach, the classifier uses zero-shot prompting with GPT-4o.

### 2. Connect the code behind the comments

**Inter-SATD Relationship Discovery (IRD)** associates detected comments with their enclosing code entities, such as functions, classes, or modules. Static analysis then looks for four kinds of dependency.

- **Calls** connect code that invokes other code.
- **Data dependencies** connect definitions of values with code that uses them.
- **Control dependencies** connect decisions with the execution they govern.
- **Module dependencies** connect importing or otherwise syntactically dependent modules.

RapidPay searches within a bounded dependency scope, using five hops by default. It gives relationships type-specific weights adjusted to the project's coupling and complexity, then constructs a directed dependency graph. Its chain-construction and visualization layer groups connected debt-bearing entities into chains, using connectivity with edge direction ignored for grouping.

In our checkout scenario, this gives the developer a way to inspect the path from the retry comment through payment handling to receipt generation. The graph retains dependency direction for the impact analysis that follows.

### 3. Estimate how widely a change could ripple

The **SATD Impact Ripple (SIR)** score summarizes an item's position in that graph. It combines three normalized structural signals.

- **Weighted fanout** measures the strength of its outgoing connections to other debt-bearing entities.
- **Weighted chain length** measures how far a dependency path can extend from it.
- **Weighted reachability** measures the wider set of debt-bearing entities reachable from it, accounting for connection strength.

Together, these signals give higher priority to items with greater potential structural influence. In the checkout example, the retry entry point could receive a higher score if its outgoing dependencies reach several other debt-bearing entities. Its actual score would depend on the extracted graph and the rest of the project.

SIR is a relative structural score. Interpreting it requires the surrounding domain knowledge, including the business importance and consequences of the behavior being changed.

RapidPay also derives a soft effort signal from repository history, combining the time between SATD-touching commits with the number of files modified. That signal helps identify potentially manageable fixes when impact scores are similar. The timing proxy can include scheduling and review delays, so its interpretation requires care.

### 4. Bring the recommendation into today's work

**Commit-Aware Insight Generation (CAIG)** adds development context. It looks for recent changes to the debt-bearing code or its graph neighbors, and considers contributors' previous work in the relevant files.

Suppose your latest commit changes payment timeout handling. RapidPay can use that activity to raise relevant debt in the checkout chain. A different item elsewhere in the repository may have a high structural score, while the payment-state fix has a timely connection to your current work.

The final ranking combines ripple impact, commit relevance, historical effort, and an LLM assessment of fix potential. For candidates assessed as having high or partial fix potential, another prompt generates an ordered remediation plan using recent changes and connected debt items.

For our illustrative shop, a developer-facing plan could propose reviewing retry behavior, introducing per-order payment state, updating receipt generation to read that state, and testing timeout and retry paths across the affected code. These steps illustrate the kind of coordinated plan the approach aims to support. A maintainer would review the proposal against the implementation.

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

The checkout example makes the practical objective tangible. A developer arrives to improve retries. A connected view helps them inspect payment state and receipt assumptions while planning that change. The research challenge is to make that guidance accurate, timely, and worth the developer's attention.

## Read the implementation and research

- [Browse the RapidPay implementation and replication package](https://github.com/ai4se4ai-lab/RapidPay)
- [View the RapidPay project and release record](/projects/rapidpay/)
- [Open the architecture figure as a PDF](/assets/img/news/rapidpay-overview.pdf)

The technical description and reported results in this article follow the author-supplied manuscript material. The publication status follows the CV record, which lists the paper as accepted and to appear in *Empirical Software Engineering*.
