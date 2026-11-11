---
title: RapidPay accepted to Empirical Software Engineering
subtitle: Technical debt does not live alone. RapidPay connects the dots and helps developers decide what to repay next.
date: 2026-10-31
tags: [Publications, Software evidence]
summary: Accepted to Empirical Software Engineering and to appear, RapidPay connects self-admitted technical debt into dependency chains and uses ripple scoring and commit context to prioritize repayment.
cover: /assets/img/news/rapidpay-overview.png
coverAlt: RapidPay overview showing SATD detection, dependency-chain construction, impact-ripple scoring, and commit-aware insights.
coverCaption: RapidPay's workflow, from developer comments and repository history to connected debt chains, impact scores, and remediation opportunities. Open the figure to view it at full size.
---

A `TODO` comment can look like a small, local problem. But software is connected: a shortcut in one function can affect the classes, modules, and data flows around it. Fixing one issue may mean untangling several others. **Which debt should a team repay, and when?**

Our paper **RapidPay: Identifying and prioritizing self-admitted technical debt chains for effective debt management in software systems** has been accepted to *Empirical Software Engineering* and is **to appear**.

**Authors:** M. Babaei, N. Ezzati-Jivan, F. Hendijani Fard, and A. Hamou-Lhadj.

## Beyond a list of TODOs

When developers acknowledge a shortcut or a known limitation in a comment, they leave behind *self-admitted technical debt* (SATD). Sometimes it is explicit, marked `TODO`, `FIXME`, or `HACK`. Sometimes it is implicit: a comment describes a temporary solution without using any of those keywords.

Detecting those comments is useful, but it leaves three questions unanswered: how debt items connect, how much their effects can ripple through a system, and when current development work creates an opportunity to address them. RapidPay brings these questions together by treating debt as **chains of connected issues**, rather than isolated comments.

## How RapidPay works

The overview above follows four stages:

1. **Detect debt (SID).** SATD Instance Detection combines lexical patterns with LLM-based analysis to identify explicit and implicit admissions of debt.
2. **Connect related items (IRD).** Inter-SATD Relationship Discovery examines call graphs, control flow, module dependencies, and data dependencies. Its Chain Construction and Visualization (CCV) layer organizes these relationships into structural propagation chains.
3. **Estimate ripple impact (SIR).** SATD Impact Ripple scoring combines intrinsic severity, outgoing chain influence, incoming chain dependency, and chain length to rank debt in its wider dependency context.
4. **Surface opportunities in context (CAIG).** Commit-Aware Insight Generation uses development changes to prioritize relevant debt and suggest remediation opportunities while developers are working nearby.

## What we found

We evaluated RapidPay on **10 open-source projects**. For debt detection, it achieved average precision of **0.90**, recall of **0.89**, and an F1-score of **0.90**, outperforming four baselines in the reported study.

We then replayed **18 months of post-snapshot commit history** across all 10 projects to examine prioritization and timing. Here, *Hit@5* measures how often the debt item maintainers actually addressed appeared among the top five recommendations.

| Finding | Reported result |
| --- | --- |
| Ranking with SIR | Hit@5 of 0.48, compared with 0.29 for the baseline; mean reciprocal rank of 0.33 |
| First-ranked recommendation | Hit@1 increased from 0.09 to 0.18 |
| Connected debt addressed together | Chain-linked items were co-addressed within 30 days at 3.2 times the rate of random, unlinked pairs |
| Adding commit context with CAIG | Hit@5 increased to 0.61, a gain of 13 percentage points over SIR alone; mean reciprocal rank of 0.42 |
| Earlier opportunities | CAIG surfaced 63% of eventually resolved SATD in its top-five recommendations at commits before maintainers addressed it |

These are **retrospective findings**: they compare recommendations with recorded maintenance activity. They do not establish that showing the recommendations to developers caused faster repayment. Structural connections point to potential propagation and useful opportunities to investigate, rather than proving that one debt item caused another.

## Why it matters

The goal is to help developers move from "we know this needs fixing" to **"this is connected, consequential, and relevant to the work we are doing now."** RapidPay combines evidence already present in comments, code dependencies, and commits to make debt repayment a more informed decision.

## Explore the work

- [Overview figure (PDF)](/assets/img/news/rapidpay-overview.pdf)
- [RapidPay project and releases](/projects/rapidpay/)
- [Open-source code: ai4se4ai-lab/RapidPay](https://github.com/ai4se4ai-lab/RapidPay)

The paper remains accepted and to appear. Final publication details will be added when available.
