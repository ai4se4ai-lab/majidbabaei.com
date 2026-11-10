---
title: Two submissions on checkable agent teams
subtitle: Trust Is Not Transitive and Safe Coordination of Untrusted AI Agents are both under review at IEEE Transactions on Software Engineering.
date: 2026-11-03
tags: [Agentic AI, Manuscripts]
summary: Contracts for LLM guardrail hierarchies, and a deterministic controller for untrusted agent proposals. Two ways of carrying human concerns into agentic systems.
---

Two single-author manuscripts from my group are now under review at *IEEE Transactions on Software Engineering*. Both sit on the "human concerns into agents" side of [my research agenda](../closing-the-loop/). They use formal specification to state, in a checkable form, what an agentic system may assume and do.

## Trust Is Not Transitive (TINT)

LLM agents increasingly rely on **several guardrails at once**, yet the safety of each guardrail does not guarantee the safety of their composition. Most existing approaches evaluate guardrails independently. That leaves open whether their assumptions and guarantees still hold when they are combined.

TINT introduces a formal framework for specifying and verifying guardrail hierarchies through **contract-based compositional reasoning**. Evidence holds only for the stage invocation that produced it, and moves forward only through explicit *gates*. The approach:

- determines whether a hierarchy satisfies its safety requirements;
- identifies **unsupported assumptions**;
- supports risk certification and incremental reassessment after the system changes.

The composition check is proved sound, and complete relative to stages constrained only by their contracts. It is near-linear for hierarchies without fact propagation and coNP-complete in general. The evaluation combines mechanized proof checks, implementation conformance testing, scalability experiments, a structural analysis of public guardrail configurations, and an exploratory analysis of published designs.

Code: [ai4se4ai-lab/trust-is-not-transitive](https://github.com/ai4se4ai-lab/trust-is-not-transitive)

## Safe Coordination of Untrusted AI Agents

When several agents propose changes to shared state, something has to decide which proposals are applied, and in what order. In this work a **deterministic controller** coordinates untrusted agent proposals, tracks the dependencies between them, and publishes consistent snapshots. The artifact includes TLA+ specifications and reproducible case studies.

Code: [ai4se4ai-lab/safe-coordination-of-untrusted-ai-agents](https://github.com/ai4se4ai-lab/safe-coordination-of-untrusted-ai-agents)

## How they fit together

Safe Coordination, TINT, and [Agent Slicing](../agent-slicing/) apply formalization and model checking to complementary aspects of AI agent teams. Safe Coordination addresses coordination, TINT addresses guardrail guarantees, and Agent Slicing addresses composition defects.
