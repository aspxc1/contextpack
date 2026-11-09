# Contextpack v1 design

Build the local repository attachment CLI described in the supplied Repository Context Packer handoff. Routine decisions below are implementation choices, not claims of user confirmation.

## Approach

Repomix configuration alone cannot provide the required task ranking, exact final-document budgeting, or exhaustive decision manifest. A full independent engine duplicates maintained scanning and tokenization. Use a thin policy layer with Repomix's public low-level components where compatible, and its maintained scanner directly if necessary. Never call its CLI/config loader or repository processors. Verify installed APIs before coupling to them.

## Scope and boundaries

Node 22+ TypeScript CLI, local folders only, offline once installed. Commands: preview and pack. Whole immutable UTF-8 file snapshots; deterministic lexical ranking; exact o200k_base final-document counts; fail-closed scanning; JSON profiles; no executable target configuration. Outputs are context.md and manifest.json in a designated directory. No models, server, upload, extension, baseline mode, or target script execution.

Discovery combines safe filesystem traversal, maintained ignore matching and Git's NUL-delimited inventory/ignore checks. Safety exclusions precede ignores, user exclusions, include allow-list, pins and ranking. Skip links, submodules, binary/invalid text and files above 512 KiB. Pins cannot override exclusions. Snapshot bytes once and derive hashes, scanner inputs, rendering and tokens from the same bytes.

Rendering uses dynamically sized Markdown fences, JSON-escaped paths, a capped directory/omission listing, declared package commands marked unverified, and explicit repository-data boundaries. A deterministic greedy whole-file selection includes all pins and re-counts the entire rendered document after every change. No truncation. Metadata must fit too.

Configuration precedence: defaults < root .contextpack.json < named profile < CLI. Explicit list flags replace configured lists. Unknown keys fail. Task text is scanned and never echoed in errors. Preview uses the same pipeline without writes or source content in JSON. Output is staged beside the destination, validated, then directory-renamed with rollback to preserve prior successful output on failure. Existing output directories must be tool-owned.

## Validation and delivery

Synthetic backend and temporary Git fixtures cover selection, tracked ignores, pins, source integrity, secrecy, scanner failure, deterministic preview/pack parity, hostile names/configs, budget failure and output rollback. Commit lockfile, README, sample profile, representative export, tests and CI. Use a new private GitHub repository by default and push the incremental history already authorized by the user. The capture is a working-tree view, not an atomic Git snapshot. Secret detection reduces accidental leaks and cannot certify absence of secrets.
