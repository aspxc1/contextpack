# contextpack

Turn a local repository into a task-focused, inspectable AI attachment. Works offline after installation, selects whole files using deterministic lexical ranking, scans for common credentials, and enforces an exact final-document token budget.

## Install and run

Requires Node.js **22 or newer**; Git is needed only for Git-aware folders. From this checkout:

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js preview examples/backend --task "Inspect refresh behavior" --focus auth --budget 5000
node dist/cli.js pack examples/backend --task "Inspect refresh behavior" --focus auth --pin "src/auth/**" --budget 5000 --out ./my-pack
```

Optionally install the built checkout as a command with `npm install -g .`, then use `contextpack` in place of `node dist/cli.js`. Nothing is uploaded or published by the tool.

```sh
contextpack preview ./backend --task-file ./task.txt --profile auth --json
contextpack pack ./backend --task "Fix refresh failures" --focus auth --exclude "fixtures/large/**" --out ./packs/login
contextpack pack ./backend --budget 20000
contextpack --help
```

`--task` and `--task-file` are mutually exclusive. Explicit task files may be outside the target repository; symlinks are refused. `--instructions TEXT` adds user instructions. No task means a general overview. Repo, output and task-file paths resolve from the shell's current directory. Remote URLs are refused. Defaults: 20,000 tokens, 512 KiB/file, output `<repo>/.contextpack`. `--max-file-bytes` can raise the file cap up to 16 MiB.

Give **context.md** to your assistant. Keep **manifest.json** locally for exhaustive decisions, eligible-file hashes/counts, configuration, versions and final-document accounting. JSON previews contain paths and accounting, never source or task/instruction text. Both reports can still reveal project structure. An attachment is a captured snapshot and grants no filesystem access; ask for missing files when more context is needed.

## Configuration

Copy [the sample](examples/contextpack.example.json) to the target root as `.contextpack.json`:

```json
{
  "budget": 20000,
  "exclude": ["fixtures/large/**"],
  "profiles": {
    "auth": {
      "focus": ["auth", "refresh"],
      "pin": ["src/auth/**"],
      "budget": 5000
    }
  }
}
```

Precedence: built-in defaults < root JSON < selected profile < explicit CLI flags. Lists **replace**, rather than append to, earlier lists; repeated CLI flags form the replacement list. Omitted flags retain configured values. Allowed root/profile keys: `include`, `exclude`, `pin`, `focus`, `budget`, `maxFileBytes`, `instructions`; only the root additionally accepts `profiles`. Unknown keys, wrong types, missing profiles and invalid budgets fail. No executable configs, auto-discovered task files, or global config.

Globs use picomatch with case-sensitive, repository-relative `/` paths and dotfile matching. `*.ts` matches root files; `**/*.ts` matches recursively; `src/auth/**` matches that subtree. Brace patterns such as `**/*.{ts,js}` work. Quote all patterns so the shell passes them literally. Absolute paths, `..` segments, backslashes, negated patterns and control characters are rejected. Use `exclude` rather than a `!` include. These patterns are separate from Git ignore syntax, which is handled by Git or the maintained `ignore` package.

## Selection and budget

Policy precedence: containment/safety → ignore rules → user exclusions → include allow-list → mandatory pins → automatic ranking. A pin matching excluded files or no eligible files fails with paths/reasons, never contents. Excluded directories are represented once and not enumerated; pins naming a path inside one fail too. Pins cannot restore ignored or unsafe files. Path ties use stable Unicode code-unit order.

Ranking is offline lexical matching, with these additive weights:

| Reason | Weight |
| --- | ---: |
| pinned | 10,000 and mandatory |
| focus substring in path / text | 100 / 35 |
| task terms in path / text | 15 per term, max 60 / 5 per term, max 30 |
| project manifest / README | 60 / 55 |
| package.json declared main/module/bin entrypoint | 50 |
| test/schema with the same filename stem as a focus/task-path match or pin | 40 |
| representative config / recognized source extension | 20 / 5 |

Task terms are distinct lowercase words of at least three characters (max 40, with a small stopword list). Focus uses literal case-insensitive substrings. This does not infer meaning or guarantee complete related context. Explicit focus/pins provide the most reliable control.

Pins go first. Other files are tried greedily in score order, skipping those that do not fit; no file is truncated, rewritten, summarized or stripped of comments. The **entire rendered context.md** is re-tokenized after every candidate, including task, instructions, headings, metadata and omissions. Directory listing is capped at 20 paths and omission examples at five; caps shrink when required metadata needs room. Exhaustive decisions remain in the manifest. Impossible metadata/pin budgets fail. Actual final tokens and SHA-256 are in the manifest, avoiding a self-referential token count in the document.

Counts use **o200k_base**, pinned **gpt-tokenizer 4.1.0**. They are exact for that encoding, and make no claim about every model's encoding or remaining conversation space. Selected package.json metadata copies declared commands and marks them **unverified**. It never executes those commands. Dynamic Markdown fences preserve embedded fences; JSON-escaped paths prevent terminal control injection. File byte counts/hashes identify exact source bytes, including whether a file ended in a newline.

## Local handling

- Git inventory includes eligible tracked and untracked files. `git check-ignore --no-index` enforces nested/global/info ignore rules **even on tracked files**. Non-Git folders use nested `.gitignore` files with `ignore`.
- Always skipped: `.git`/`.hg`/`.svn`, `node_modules`, `bower_components`, `vendor`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.venv`/`venv`/`env`, `__pycache__`, `.cache`, `.pytest_cache`, `.mypy_cache`, `.tox`, `target`, `.npm`, `.yarn`, `.pnpm-store`, `packs`, `.contextpack`, tool temporary/backup/lock directories, known output filenames and tool configs. Change placement with `--out`, and add exclusions with flags/profiles; built-in safety exclusions cannot be disabled.
- Credential directories (`.aws`, `.ssh`, `.azure`, `.gcloud`, `.kube`, `.gnupg`), `.env`/`.env.*`, private-key extensions, credential filenames and package-manager credential files are skipped before reading. `.env.example`, `.env.sample`, `.env.template` are allowed only after scanning.
- Skip symlinks/junctions, submodules, non-regular/unreadable files, oversized files, NUL/control-containing binaries and invalid UTF-8. No links outside the root are followed. Ignored/unsafe files have no bookkeeping content hash.
- Secretlint **13.1.0** recommended scanner rules run on captured source, user text and path metadata; AWS ID detection is enabled and source comments cannot disable scanning. Flagged source is excluded; flagged user text/metadata and scanner failures block export. No matched values are logged or stored in the manifest. **Filename rules and scanning reduce accidental leaks; they do not certify an export as secret-free.**
- Source is read once after filters. Scanning, counts, hashes and rendering use those captured bytes. Git metadata is captured once; dirty status excludes the designated output. Capture is sequential, not an atomic Git snapshot. Identical captured bytes/configuration/task/versions/metadata produce identical document bytes. No timestamps or machine-specific absolute paths appear in the document.
- Preview performs the same capture and rendering, with no writes. Pack writes two complete files into a sibling staging directory and renames the directory into place. Existing output must be empty or contain exactly the two regular tool-owned export files. On replacement errors it restores the previous directory. Successful replacement is the commit point; later cleanup failures produce warnings and retain any remaining backup/lock for inspection. A per-output lock prevents concurrent writers. A hard process/OS crash can leave a `.contextpack-backup-*`, `.contextpack-tmp-*` or `.contextpack-lock-*` directory; inspect/recover the backup before clearing a stale lock. Filesystem rename semantics apply; the pair is not a crash-durable database transaction.
- No target dependency installation, scripts, hooks, model calls, cloning or network requests. Installed package code supplies the scanner/tokenizer only. [Compatibility notes](docs/compatibility.md) explain why the Repomix high-level engine is bypassed in favor of its maintained underlying components.

## Development and verification

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
npm pack --dry-run
```

Acceptance fixtures exercise real temporary Git repositories and the real scanner/tokenizer, including tracked ignores, secret exclusions, scan failure, pins/budgets, 1,100 omissions, preview/pack hashes, symlinks/submodules, configuration precedence, output preservation, a malicious executable-config sentinel and Node network APIs disabled. [The sample export](examples/export/context.md) and [its manifest](examples/export/manifest.json) were generated from the synthetic backend. No real repository data or credentials are needed.

Tested locally on Windows with Node 24.20.0. Git-fixture tests need filesystem access to temporary `.git` directories; the Codex sandbox requires escalation for those operations. POSIX newline/control filenames and Unix permission-denial cases cannot all be created meaningfully on Windows. CI covers Windows/Ubuntu and Node 22/24; refer to its actual run status rather than assuming those platforms passed locally.

No web service, semantic index, editor extension, partial-file extraction or export-baseline mode is included in v1.
