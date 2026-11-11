---
title: SkillSpec accepted to the ICSE 2027 Research Track
subtitle: A formally verifiable specification format for composing agent skills, with Abbas Heydarnoori.
date: 2026-10
tags: [Publications, Agentic AI]
summary: Our paper on verifiable contracts for composing agent skills will appear in the research track of the IEEE/ACM International Conference on Software Engineering.
---

I am delighted to share that **SkillSpec: A formally verifiable specification format for composing agent skills**, with Abbas Heydarnoori, has been accepted to the **Research Track of ICSE 2027**, the IEEE/ACM International Conference on Software Engineering. The paper is to appear.

## Why skills need specifications

Agentic systems increasingly gain new abilities by composing *skills*: packaged instructions, tools, and resources an agent loads when a task calls for them. Composition is where things go wrong. Two skills may each work alone yet conflict, or make incompatible assumptions, once combined.

SkillSpec gives skills **verifiable contracts**, so that their composition can be checked and repaired with explicit guarantees. In terms of [my research agenda](../closing-the-loop/), it is a direct example of carrying human concerns down into agentic systems as checkable models.

## Code

The benchmark and tooling are at [ai4se4ai-lab/swe-multiskillsbench](https://github.com/ai4se4ai-lab/swe-multiskillsbench). I will add a link to the paper once the proceedings are available.
