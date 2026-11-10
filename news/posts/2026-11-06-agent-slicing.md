---
title: "Agent Slicing: finding the blind spots of multi-agent AI teams"
subtitle: A new manuscript, submitted to ACM TOSEM, on detecting and localizing composition defects before a team ever runs.
date: 2026-11-06
tags: [Agentic AI, Manuscripts]
summary: Individual-agent checks miss many defects that only appear when agents are composed. Agent slicing detects them and points to the interactions that explain them.
---

I have submitted **Agent Slicing: Localizing Blind Spots in Multi-Agent AI Teams** to *ACM Transactions on Software Engineering and Methodology (TOSEM)*. The work sits squarely on the "behavior back to humans" side of [my research agenda](../closing-the-loop/). It gives people an abstraction that explains *which* component interactions undermine a team's declared guarantees.

## The problem

Teams of AI agents can lose software-quality guarantees through routing decisions, join policies, and shared-model failures. Checking each agent on its own misses these defects. Checking the whole team can detect a symptom, but does not, by itself, isolate the interactions that explain it.

## The idea

*Agent slicing* detects and localizes composition defects in **declared team models, before execution**. A slice analyzes a convex group of components exactly, while taking the rest of the team at face value. Candidate findings are confirmed against full-team runs, and confirming slices are then **shrunk** to focus the explanation.

The manuscript formalizes slice contracts and *defect depth*: the smallest number of components whose joint analysis confirms a symptom. It establishes soundness, monotonicity, separation from individual-agent checking, compositionality conditions, and rules for incremental rechecking.

## What we found

- Across **1,680** generated teams subjected to random engineering changes, **36.1%** of defect symptoms escaped individual-agent checks.
- Confirmed slicing detected **99.9%** of those hidden symptoms **without false findings**.
- Shrinking from the whole team identified an inclusion-minimal confirming slice for **99.2%** of the hidden symptoms scored for localization.
- A global must-analysis also detected all hidden symptoms, but it produced false findings and identified only symptom nodes.
- **Six of nine** encoded published designs exhibited hidden defects.

> Agent slicing gives us a basis for diagnosing which component interactions undermine a team's declared guarantees.

## Try it

The research artifact is public at [ai4se4ai-lab/AgentSlicing](https://github.com/ai4se4ai-lab/AgentSlicing). The paper is under review; I will share an update when there is a decision.
