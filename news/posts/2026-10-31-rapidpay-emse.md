---
title: RapidPay accepted to Empirical Software Engineering
subtitle: Identifying and prioritizing chains of self-admitted technical debt, so teams pay down the debt that matters most first.
date: 2026-10-31
tags: [Publications, Software evidence]
summary: Our paper on self-admitted technical-debt chains has been accepted to the Empirical Software Engineering journal and is to appear.
---

Our paper **RapidPay: Identifying and prioritizing self-admitted technical debt chains for effective debt management in software systems** has been accepted to *Empirical Software Engineering* and is to appear.

**Authors:** M. Babaei, N. Ezzati-Jivan, F. Hendijani Fard, and A. Hamou-Lhadj.

## What it is about

Developers often leave comments that admit a shortcut, such as a `TODO`, a `FIXME`, or a note that a design is temporary. This is called *self-admitted technical debt (SATD)*. Debt items rarely live alone: one shortcut leads to others, forming **chains** of debt across a codebase.

RapidPay identifies these technical-debt chains and **prioritizes them by impact-ripple ranking (SATD Impact Ripple)**. Teams can then focus repayment effort where it has the widest effect.

The work belongs to the "software evidence" thread of my research. It recovers useful structure from what a codebase already tells us, and turns it into maintenance decisions developers can check.

## Code

The tool is available at [ai4se4ai-lab/RapidPay](https://github.com/ai4se4ai-lab/RapidPay). Final publication details will be added once the article is published.
