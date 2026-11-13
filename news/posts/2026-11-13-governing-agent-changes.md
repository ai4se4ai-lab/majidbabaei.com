---
title: "An AI agent fixed its tool. Who checks what happens next?"
subtitle: How SSEVOH-DSL adds checked changes, traceable approvals, and controlled reuse to Harness²—and how to try it yourself.
date: 2026-11-13
tags: [Agentic AI, Research Software, Software Engineering]
summary: Let agents propose improvements while trusted code controls what takes effect. Explore SSEVOH-DSL's Harness² integration, run a local demo without an LLM, and inspect the evidence behind each change.
featured: true
cover: /assets/img/news/governing-agent-changes.jpg
coverAlt: A human-controlled checkpoint separates proposed tool changes from active software; a teal branch leads to a report and a memory notebook, while a coral branch of withdrawn tools carries stop symbols.
coverCaption: "Conceptual illustration, generated with AI: approving a change is the start of its accountability story. Withdrawn origins must remain visible wherever their results are reused."
---

Imagine an AI agent fixes a tool, passes its tests, and saves the improvement for tomorrow. Another agent builds a skill around that tool. A useful lesson goes into memory. Then someone discovers a defect in the original repair.

Restoring the old tool is only part of the job. **What happens to the skill and the lesson that grew out of the faulty version?**

That is the practical problem behind **SSEVOH-DSL**. It lets an agent suggest changes while an independent service checks whether those changes are allowed—and whether their results remain eligible for later use. The [repository README](https://github.com/ai4se4ai-lab/SSEVOH-DSL/blob/main/README.md) provides the implementation, examples, verification commands, and a pinned integration with **Google Research Harness²**.

## Why the harness matters

An agent's **harness** is the software around the model: tools, prompts, memory, workflows, and configuration. It shapes what the agent can do and what experience it carries into the next task.

Letting an agent improve this environment can be useful. A recurring repair could become a reusable tool. A successful approach could become a skill. But those changes become infrastructure for future behavior, so a good answer on one task is not enough to justify every later use.

SSEVOH-DSL separates three decisions: **propose a change, approve it, and deploy it**. Understanding a proposal does not authorize it. Approval is tied to the state and evidence that were actually checked. If that context changes before deployment, the service requires fresh approval.

## What it adds to Harness²

The Harness² bridge adds checks at the points where improvements enter the system, run, and become available for reuse. It preserves the upstream workflows for proposing, probing, composing, selecting, and reflecting on improvements, as well as using a library on later tasks. The integration targets a [specific upstream commit](https://github.com/ai4se4ai-lab/SSEVOH-DSL/blob/main/integrations/harness2/upstream-pin.json), giving experiments a fixed starting point.

For someone experimenting with self-evolving agents, the practical benefits are concrete:

- **Keep control over what may change.** Operator-owned rules limit the target, operation, and capabilities. Permission to repair a tool does not automatically permit editing protected policy or verifiers.
- **Connect approval to the checked artifact.** The adapter binds approval receipts to artifacts and rechecks their exact bytes before execution. An approval cannot simply be carried over to a modified file.
- **Recheck affected components.** Replacing a component can temporarily disable dependents until they are revalidated, rather than silently keeping incompatible assumptions active.
- **Control what enters the reusable library.** Publication and reuse pass through guards. Recorded origins let a withdrawal affect artifacts derived from the withdrawn version.
- **Investigate why a change took effect.** Version history and hash-chained journal records support inspection and replay checks within the documented trust assumptions.

These mechanisms give developers explicit places to enforce their rules and inspect failures. They do not establish that an accepted improvement solves the task better.

## Follow one repair through its lifecycle

Consider a ledger with a $9 payment and a $2 refund. A faulty tool ignores the refund and reports $9; the correct total is $7.

An agent proposes a repair. Trusted validators check the evidence required by the operator. If the proposal is approved, it receives a single-use approval tied to the current context. Deployment checks that this context still holds.

After the tool changes, a dependent reporting skill may need revalidation. If the repaired version is later withdrawn, the system also follows recorded derivation links to prevent affected skills or retained lessons from being reused. Recovery checks an older version against current rules and history before restoring it.

Two records make this possible: **dependencies** describe what a component needs to operate; **provenance** describes the versions used to derive it. A dependency change can require retesting. A withdrawn origin can disqualify later reuse.

## Try the core locally, without an LLM

The easiest starting point is the small demonstration sandbox. The core needs **Python 3.11 or newer** and has no third-party runtime dependencies. Its quick start needs no model service, Java, GPU, or cluster account.

In a Bash shell on Linux or macOS, follow the [README quick start](https://github.com/ai4se4ai-lab/SSEVOH-DSL#quick-start):

```bash
git clone https://github.com/ai4se4ai-lab/SSEVOH-DSL.git
cd SSEVOH-DSL
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .

ssevoh compile examples/basic-evolution/example.sse
ssevoh demo examples/basic-evolution/example.sse
ssevoh verify
```

On Windows PowerShell, create the environment with `python -m venv .venv` and activate it with `.\.venv\Scripts\Activate.ps1`; then use the same installation and `ssevoh` commands.

Each command answers a different question:

| Command | What you can inspect |
| --- | --- |
| `compile` | Whether the proposal parses and type-checks; it prints a JSON representation. |
| `demo` | Approval and deployment in a fresh example sandbox; successful output includes `revision: 1` and the journal. |
| `verify` | The built-in bounded lifecycle checks; a successful report includes `passed: true`. |

The demo supplies a permissive example policy for its operator. In an application, you must provide your own trusted initial state, policy, authenticated identity, and validators. Compilation by itself never grants permission to deploy.

Next, explore the repository's [six examples](https://github.com/ai4se4ai-lab/SSEVOH-DSL/tree/main/examples), including tool permissions, dependency changes, memory evolution, and withdrawal. They offer small cases for understanding which rule rejects a proposal before attempting a larger integration.

## Move from the demo to Harness²

The integration needs **Python 3.12 or newer, Git, Java, and current core assurance evidence**. The full assurance workflow uses `make verify` and the checksum-pinned TLC checker; it is broader than the CLI's `ssevoh verify` suite.

After completing that workflow, the [Harness² setup guide in the README](https://github.com/ai4se4ai-lab/SSEVOH-DSL#work-with-the-harness%C2%B2-integration) walks through fetching the pinned upstream source, packaging its runtime, and checking the upstream tests, adapter, workers, and publication model. Read the [integration contract](https://github.com/ai4se4ai-lab/SSEVOH-DSL/blob/main/integrations/harness2/formal/contracts.md) before changing what the adapter can execute: the original ledger integration uses a finite Python syntax catalog and a bounded executor, while later coding and ToolRepair studies have separate boundaries.

Researchers can also [reanalyze retained results](https://github.com/ai4se4ai-lab/SSEVOH-DSL#reanalyze-the-collected-studies) without generating new model outputs. This provides a practical route to inspect the recorded decisions and compare enforcement conditions before arranging model inference or cluster experiments.

## What to expect from the prototype

SSEVOH-DSL is a **research prototype**. Its core keeps trusted metadata in memory; recreating the engine does not provide durable recovery after a crash. The default structural validator checks metadata, so claims about a tool's behavior need appropriate semantic validators. A hostile agent must also be separated from the service's policy, identity, validators, and memory by a suitable host or process boundary.

The [README's evidence summary](https://github.com/ai4se4ai-lab/SSEVOH-DSL#evidence-and-research-limits) keeps authorization and usefulness separate. In the controlled Harness² shared-fixture trials, full assurance accepted all 15 legitimate trials and none of 45 prohibited trials. The evolved and frozen model workflows both achieved zero task successes out of 50 outcomes. Those observations support studying the enforcement mechanisms; they do not demonstrate a task-performance gain or universal safety.

For practitioners, the useful starting point is therefore a controlled experiment: define a small set of editable components, specify permissions, supply validators you trust, and inspect approval, deployment, withdrawal, and recovery together. Keep production deployment and arbitrary generated-code safety outside what this prototype has demonstrated.

**Start with one proposed change—and make its permission, evidence, and consequences visible.** Explore the [tool and README](https://github.com/ai4se4ai-lab/SSEVOH-DSL) or the [project overview](/projects/ssevoh-dsl/) to continue.
