# repoyard

```
myapp-workspace/          ← workspace, outside the repo's git
├── CLAUDE.md             ← personal agent instructions
├── notes/                ← plans, research, session notes
├── scratch/              ← agent exhaust, one-off scripts
└── myapp/                ← the git repo
```

A tiny CLI that scaffolds one convention: an untracked parent folder holding
your git repo plus the personal and agent files that must never be
committable.

## Why: you can't commit what git can't see

LLM-assisted work produces exhaust: plans, research notes, half-finished
scripts, agent instructions. That stuff belongs near the repo but not in it,
and `.gitignore` is a promise, not a guarantee. One `git add -f`, one overly
broad pattern change, one agent that "helpfully" cleans up your ignore file,
and private notes are in history forever. Files that live one directory
above the repo root are structurally invisible to git, so there is nothing
to leak.

## Usage

```sh
npx repoyard create myapp     # greenfield: workspace + empty git repo inside
npx repoyard adopt            # run inside an existing repo root: wraps it
npx repoyard doctor           # check a workspace against the convention
```

Run it bare on a terminal and it asks: which command, the project name,
which agent file. Enter accepts the default on every question. Flags,
`--no-input`, or piped stdin skip the prompts entirely.

Flags: `--no-input` (accept defaults, for scripting), `--dry-run` (print
planned operations, touch nothing), and `--agent-file=claude|agents|both|none`
to pick which agent instructions file the workspace gets. Default is
`claude`; `both` writes `AGENTS.md` plus a `CLAUDE.md` that just imports
it, since Claude Code reads only `CLAUDE.md`; `none` skips the file (note
that `doctor` treats a missing agent file as a deviation). That's the
complete list.

One honest caveat on `agents`: the workspace trick depends on a tool
loading instruction files from directories *above* the repo root, which
Claude Code does. Most AGENTS.md tools only look inside the repo, so a
workspace-level `AGENTS.md` may be invisible to them.

`adopt` is the one you'll actually use. Run it from the root of a repo with
a clean tree; it creates the sibling workspace, moves the repo inside it
with a same-filesystem rename (rolled back automatically if anything fails),
scaffolds `CLAUDE.md`, `notes/`, and `scratch/`, and prints the `cd` to run.
Run it in a directory that isn't a repo yet and it offers to `git init`
first, then adopt (interactive only; `--no-input` keeps the refusal, and
running inside a repo below its root still refuses outright).
During scaffolding it offers to `git init` the workspace itself, which gives
`notes/` a private history. Default is no. Either way the workspace gets a
`.gitignore` covering the repo dir and `scratch/`, so a workspace repo
created now or months later starts out safe.

`doctor` prints what deviates from the convention and exits non-zero. It
never fixes anything.

## Yes, this is basically mkdir

The value is the codified convention, not the syscalls: the naming, what
goes where, an agent-facing `CLAUDE.md` that explains the layout to any
tool that reads ancestor directories. You could do this by hand; the
point is that you, your agents, and your other machines all do it the same
way.

## Why the `-workspace` suffix goes on the outside

The repo keeps the clean name; the wrapper takes the suffix.

- Terminal tabs show the innermost folder, so your tabs say `myapp`, not
  `myapp-workspace`, and no two projects' tabs collide on a generic name.
- Folder-derived tool names (docker compose project names, `npm init`
  defaults) come from the repo dir and stay clean.
- The repo dir matches the GitHub repo name, so `git clone` inside a fresh
  workspace reproduces the layout with no target argument.

## What else lives well in a workspace

The tool scaffolds none of these; the location just works.

- Worktrees: `git worktree add ../myapp-wip` from inside the repo puts the
  checkout next to `notes/` instead of littering the parent directory.
- A second repo: some projects are several repos (`myapp`, `myapp-landing`).
  Extra repos sit as siblings inside the workspace, which stays named after
  the primary one.
- `.env` files and other secrets your tooling reads: the project repo
  cannot commit them, same as the notes.

The generated workspace `.gitignore` covers only the repo dir and
`scratch/`. If you gave the workspace its own git repo, extend it by hand
so worktrees, extra repos, and secrets stay out of the private history too.

## Out of scope, permanently

- Worktree management; the layout already handles worktrees without help.
- Language or framework templates, `.env` handling, editor config.
- Windows: probably works, untested.
- Auto-update, telemetry, config files, plugins.

Blog post with the full rationale: coming soon.

## License

MIT
