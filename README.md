# contextpack

Give an AI assistant the useful parts of your repository in one file.

Describe your task, choose a token budget, and contextpack gathers relevant source files into **context.md**. It works offline and never uploads anything.

## Get started

You need **Node.js 22+**. Install and build from this checkout:

```sh
npm ci --ignore-scripts
npm run build
```

Try the included demo:

```sh
node dist/cli.js pack examples/backend --task "Review token refresh" --focus auth --out ./my-pack
```

You'll get:

- **my-pack/context.md** — attach this to your AI chat.
- **my-pack/manifest.json** — see which files were included or skipped, and why.

For your own project, replace `examples/backend` with its folder path.

## Adjust what gets included

| Option | What it does |
| --- | --- |
| `--task "Fix login"` | Describes the work you want help with |
| `--focus auth` | Prioritizes matching files |
| `--budget 10000` | Limits the exported document to 10,000 tokens |
| `--pin "src/auth/**"` | Requires those files to fit, or stops with an error |
| `--exclude "fixtures/**"` | Leaves those files out |
| `--out ./my-pack` | Chooses where to save the output |

To check the selection without saving anything, use `preview` instead of `pack`.

Ignored files, common secret files, dependencies, and build output are skipped. Selected files stay intact. Secret scanning helps prevent leaks, but review the attachment before sharing it.

## More

- [All options, saved profiles, and selection rules](docs/reference.md)
- [Example configuration](examples/contextpack.example.json)
- Run `node dist/cli.js --help` for every flag.
- Run `npm test` to check the project.
