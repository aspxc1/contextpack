# Contextpack Implementation Plan

> Execute inline using superpowers:executing-plans; test behavior before implementing each task.

**Goal:** Deliver the handoff's complete offline v1 CLI and push incremental history.
**Architecture:** Policy modules isolate discovery/snapshot, scanning adapter, ranking/rendering/budget, config/CLI, and atomic output.
**Tech stack:** TypeScript, Node 22+, Repomix public tokenizer, Secretlint, ignore, picomatch, Node test runner.
**Spec:** docs/superpowers/specs/2026-11-09-contextpack-design.md and the supplied Repository_Context_Packer_Agent_Handoff.md.

## Global constraints

No target execution, network at runtime, remote repositories, content truncation, secret match logging, or executable configuration. 512 KiB default per file. Exact final o200k_base count. Fail closed. Stable output. Pins never override exclusions.

## Review focus

Output/config/task symlinks must not read or overwrite unintended paths. Git subdirectories must remain contained. Hostile filenames must remain escaped. Scanner exceptions cannot expose source. Existing exports survive all failures.

## Tasks

1. Compatibility and scaffolding: pin dependencies; inspect public API and side effects; test tokenizer/scanner contracts and sentinel non-execution. Record adapter decision. Commit.
2. Discovery and snapshot: write failing fixture tests for ignores, containment, safety, binary/text/size, Git state, pins; implement src/discovery.ts and src/security.ts. Verify suite and commit.
3. Selection/export: write failing tests for ranking, whole files/fences, budgets, omissions, deterministic context and source-free manifest; implement src/ranking.ts, src/render.ts, src/pack.ts. Verify suite and commit.
4. Configuration/CLI/output: write failing tests for strict JSON precedence, task files, preview parity/no writes, atomic pack and failure preservation; implement src/config.ts, src/cli.ts, src/output.ts. Verify suite and commit.
5. Deliver: backend fixture, example config/export, README, Windows/Linux CI; run install/build/test and real CLI commands, review whole branch, fix findings with regression tests, commit and push new private repository.

Each task follows failing test -> observed failure -> implementation -> suite -> commit. Track observed results in docs/implementation-log.md.
