---
title: Two papers at ICSE 2026, TAAF and SIKG
subtitle: Knowledge graphs meet execution traces and test selection at the IEEE/ACM International Conference on Software Engineering.
date: 2026-04
tags: [Publications, Software evidence]
summary: A research paper on trace analysis with knowledge graphs and LLMs, and a poster on semantic impact analysis for adaptive test selection.
---

Two pieces of our work appear at **ICSE 2026**. Both use knowledge graphs to recover useful structure from what software actually does.

## TAAF: trace abstraction and analysis with knowledge graphs and LLMs

*A. Ezaz, G. Khodabandeh, M. Babaei, and N. Ezzati-Jivan.* [doi:10.1145/3744916.3787832](https://doi.org/10.1145/3744916.3787832)

Execution traces are among the richest sources of evidence about a running system, and among the hardest to read. **TAAF** helps developers investigate large traces by combining **time-indexed knowledge graphs** with language models. Questions retrieve relevant graph context, so developers no longer need custom trace-analysis scripts.

The paper also introduces **TraceQA-100**, a benchmark grounded in kernel traces. It evaluates where graph context improves reasoning and where limitations remain.

This paper grew out of the M.Sc. thesis of Alireza Ezaz at Brock University, which I co-advised with Prof. Naser Ezzati-Jivan. Code: [Alireza-Ezaz/TAAF](https://github.com/Alireza-Ezaz/TAAF).

## SIKG: semantic impact knowledge graphs for test selection (poster)

*M. Babaei, N. Ezzati-Jivan, and L. Wei.* ICSE Companion, Poster Track. [doi:10.1145/3774748.3795655](https://doi.org/10.1145/3774748.3795655)

**SIKG** combines semantic classification of source-code changes with propagation through an **impact knowledge graph**. Test results inform reinforcement-learning updates to the graph weights and selection policies. A Visual Studio Code extension applies the approach to Python projects. The goal is to reduce testing effort while keeping fault detection.

Code: [ai4se4ai-lab/SIKG](https://github.com/ai4se4ai-lab/SIKG)
