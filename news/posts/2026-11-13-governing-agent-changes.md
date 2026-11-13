---
title: "An AI agent fixed its tool. Who checks what happens next?"
subtitle: My new IEEE TSE submission explores how permission, evidence, and accountability can keep pace with agents that change their own software.
date: 2026-11-13
tags: [Agentic AI, Manuscripts, Software Engineering]
summary: A repair can pass its tests and still leave trouble behind. SSEVOH-DSL keeps approvals tied to the versions they checked and stops tools, skills, and memories from reusing withdrawn work.
featured: true
cover: /assets/img/news/governing-agent-changes.jpg
coverAlt: A human-controlled checkpoint separates proposed tool changes from active software; a teal branch leads to a report and a memory notebook, while a coral branch of withdrawn tools carries stop symbols.
coverCaption: "Conceptual illustration, generated with AI: approving a change is the start of its accountability story. Withdrawn origins must remain visible wherever their results are reused."
---

Imagine an AI agent notices a bug in its accounting tool. It fixes the code, runs the tests, and gets the right answer. So far, so good.

The agent then builds a reporting skill around the repair and saves a lesson for future work. Days later, someone discovers that the repair was faulty and withdraws it. The original tool can be restored. **But what happens to the report and the lesson that grew out of the withdrawn version?**

That question is at the heart of my new manuscript, **Governing Changes in Self-Evolving Agents**, which I have submitted to *IEEE Transactions on Software Engineering (TSE)*. I am the sole author. This is a submission announcement; the paper has not been accepted or published.

## When an agent's work becomes its own infrastructure

Many familiar AI interactions end with an answer. A self-evolving agent can leave behind changes that shape its next task: a revised prompt, a new tool, a reusable skill, a modified workflow, or a stored lesson.

The software around the model is often called a **harness**. It determines which tools the model can use, how tasks run, and how experience is retained. When agents can change that harness, today's output can become tomorrow's operating environment.

That is useful: an agent might repair a recurring bug or save a better way to solve a task. It also creates a software engineering problem. A successful test answers a question about the tested behavior. Permission to make the change, and permission to keep using its consequences after other changes occur, require their own checks.

## A seven-dollar example

The paper uses a small ledger example. An account has a **$9 payment and a $2 refund**. A faulty tool ignores the refund and reports $9. The correct total is $7.

Suppose the agent repairs the tool. Three different questions immediately arise:

1. **May it make that repair?** Permission to edit an accounting tool does not automatically permit changing protected guardrails or adding network access.
2. **Is its approval still current?** If another update changes the system while this repair is waiting, an approval based on the old state may no longer apply.
3. **What happens downstream?** A reporting skill that depends on the replaced tool may need to be checked again. If the repair is later withdrawn, a skill or lesson derived from that repair must not quietly remain available.

These are different obligations. Retesting a dependent report after an update and withdrawing descendants of a disqualified source require different records and responses.

## The approach: rules that stay attached to a change

The manuscript introduces **SSEVOH-DSL**, a small language for writing rules about self-modification, together with a trusted service that enforces them. I call these rules **Foundational Contracts** because they govern the infrastructure on which later agent behavior depends.

The idea builds on a familiar software engineering practice: make the conditions for an operation explicit. Here, those conditions continue to matter after the operation finishes.

The agent can propose an improvement. The human operator controls the rules: what may change, which evidence is required, and which parts remain protected. The enforcement service decides whether a proposal can take effect. It leaves the agent's method of searching for improvements in place.

Think of approval as a receipt for **this version, in this system state, under these rules, with this evidence**. It is not an open-ended permission slip.

- **Before a change takes effect**, the service checks that the approval still matches the current context. An intervening change can make the receipt stale.
- **After a component is replaced**, dependent components are temporarily disabled until they have been revalidated.
- **When an artifact runs**, the service checks its identity and eligibility, including whether it still matches what was approved.
- **When a version is withdrawn**, recorded derivation links carry that withdrawal through to artifacts derived from it, including retained skills and lessons.
- **During recovery**, an older version can be restored only if it remains eligible. Being old does not make it acceptable automatically.

This depends on recording two relationships carefully: what a component **needs to operate**, and which earlier versions were **used to derive it**. A dependency tells us where a replacement may require retesting. A derivation tells us where a withdrawal must propagate.

## What the evaluation found

The paper examines both the rules and their implementation. Bounded conformance checks covered **248,832 one-step cases** and **19,620 explored transitions**, alongside TLA+ model checking. Within those checked bounds, the implementation agreed with independent reference semantics.

I also integrated the service into **Harness²**, the self-evolving agent harness discussed in the manuscript. Across deterministic tests, model-generated tests, and tests inside that host, the service blocked **all 178 assessed contract violations** and rejected **no permitted change** in those assessments.

The measured **median admission time was 0.6 milliseconds**. That is the time for the admission check, not the total cost of running an agent or validating a repair. In the host integration, full enforcement added 37.6 milliseconds to the mean permitted execution; stronger validators can add further cost.

These results support the feasibility of enforcing the specified lifecycle rules in the evaluated setting. They do not establish that every possible harmful change will be caught.

## What the contracts cannot promise

A permitted change can still contain a bug that its tests miss. The system relies on trustworthy validators, operator policy, isolation, and an adapter that routes relevant actions through the guards. If an action bypasses those guards, the claimed protection does not apply.

The empirical study uses one host and small task settings; portability across other frameworks remains untested. The work also does not establish verified recovery across restarts or distributed commits. Withdrawing a version cannot erase information already present in a model's context or undo an external action that has already happened.

There is a practical trade-off, too. Very restrictive checks can reject useful repairs, while more flexible behavioral tests can miss defects. The task studies do **not** demonstrate an accuracy advantage over keeping the selection frozen.

## Where this fits in my research

My [research agenda](/news/closing-the-loop/) connects **Human ⇄ Agentic AI** through abstractions in both directions. Explicit models carry human concerns to agents; understandable records of behavior carry evidence back to people.

Foundational Contracts apply that perspective to self-evolution. People express permissions and evidence requirements in a checkable form. Version and origin records make it possible to follow the consequences of a change and enforce a later withdrawal.

The question I want this work to make easier to answer is simple: **as an agent changes its own working environment, can we still explain why each part is allowed to be there?**

The [project's submission release](/projects/ssevoh-dsl/) records this milestone. This overview is based on the submitted manuscript; no public paper or code link is announced here.
