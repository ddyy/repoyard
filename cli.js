#!/usr/bin/env node
// repoyard — scaffold an untracked workspace directory around a git repo.
// Zero dependencies. Node 20+.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import readline from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";

const USAGE = `repoyard — scaffold an untracked workspace around a git repo

Usage:
  repoyard create <project>   greenfield: workspace + empty repo (git init)
  repoyard adopt              run inside an existing repo root: wraps it
  repoyard doctor             check an existing workspace against the
                              convention; prints diffs, fixes nothing

Flags:
  --no-input    accept defaults for all prompts (for scripting)
  --dry-run     print planned operations, touch nothing
  --agent-file=<claude|agents|both|none>
                which agent instructions file to scaffold (default: claude;
                both = AGENTS.md plus a CLAUDE.md that just imports it;
                none = skip it)
  -h, --help    show this help

On a terminal, anything you leave out is asked interactively (Enter accepts
the default). Flags, --no-input, or piped stdin skip the questions.

Layout created (for a project named "foo"):
  foo-project/          workspace, untracked
  ├── CLAUDE.md         agent instructions for the workspace
  ├── notes/            durable personal notes
  ├── scratch/          disposable agent exhaust
  └── foo/              the git repo (clean name; matches GitHub repo)
`;

// ---------------------------------------------------------------- templates

const tmplAgentMd = (repo) => `# Workspace for ${repo}

- \`${repo}/\` — the git repo; the only thing that ships
- \`notes/\` — durable personal notes
- \`scratch/\` — disposable: agent exhaust, one-off experiments

Never reference workspace files (\`../notes\`, \`../scratch\`, this file)
from code or docs committed inside \`${repo}/\`.

## Personal instructions

(add your own here)
`;

const tmplNotesReadme = (repo) =>
  `Durable personal notes for ${repo}: plans, research, session notes.\n`;

const tmplScratchReadme = () =>
  `Disposable; anything durable graduates to the repo's docs/.\n`;

const tmplWorkspaceGitignore = (repo) => `/${repo}/\nscratch/\n`;

// ------------------------------------------------------------------ helpers

const flags = { input: true, dry: false, agentFile: "claude" };

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// Print the operation; perform it unless --dry-run.
function op(desc, fn) {
  console.log(`${flags.dry ? "[dry-run] would " : ""}${desc}`);
  if (!flags.dry) fn();
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

const interactive = () => flags.input && !flags.dry && process.stdin.isTTY;

async function ask(question, def = "") {
  if (!interactive()) return def;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (
      await rl.question(def ? `${question} [${def}] ` : `${question} `)
    ).trim();
    return answer || def;
  } catch {
    console.log();
    fail("cancelled"); // Ctrl+D / Ctrl+C at the prompt
  } finally {
    rl.close();
  }
}

async function confirm(question, def = false) {
  const answer = (await ask(`${question} ${def ? "[Y/n]" : "[y/N]"}`))
    .toLowerCase();
  if (answer === "") return def;
  return answer === "y" || answer === "yes";
}

// Arrow-key menu: up/down to move, Enter to pick, Esc/Ctrl+C/Ctrl+D cancels.
function select(question, options, defIndex = 0) {
  if (!interactive()) return Promise.resolve(options[defIndex]);
  let i = defIndex;
  console.log(question);
  const render = (redraw) => {
    if (redraw) process.stdout.write(`\x1b[${options.length}A`);
    for (let j = 0; j < options.length; j++)
      process.stdout.write(`\x1b[2K${j === i ? "❯" : " "} ${options[j]}\n`);
  };
  render(false);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    const done = (value) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("keypress", onKey);
      process.stdout.write(`\x1b[${options.length + 1}A\x1b[0J`);
      if (value === null) fail(`${question} cancelled`);
      console.log(`${question} ${value}`);
      resolve(value);
    };
    const onKey = (str, key) => {
      if (key.name === "up" || (key.name === "k" && !key.ctrl))
        i = (i + options.length - 1) % options.length;
      else if (key.name === "down" || (key.name === "j" && !key.ctrl))
        i = (i + 1) % options.length;
      else if (key.name === "return" || key.name === "enter")
        return done(options[i]);
      else if (key.name === "escape" || (key.ctrl && "cd".includes(key.name)))
        return done(null);
      else return;
      render(true);
    };
    process.stdin.on("keypress", onKey);
  });
}

async function chooseAgentFile() {
  if (flags.agentFileSet) return;
  const picked = await select("agent instructions file:", [
    "CLAUDE.md",
    "AGENTS.md",
    "both",
    "none",
  ]);
  flags.agentFile = { "CLAUDE.md": "claude", "AGENTS.md": "agents" }[picked] ?? picked;
}

// Write CLAUDE.md, notes/, scratch/ (and optionally git init) into a workspace.
function scaffoldWorkspace(ws, repo, wsGit) {
  const agentFiles = {
    claude: [["CLAUDE.md", tmplAgentMd(repo)]],
    agents: [["AGENTS.md", tmplAgentMd(repo)]],
    both: [["AGENTS.md", tmplAgentMd(repo)], ["CLAUDE.md", "@AGENTS.md\n"]],
    none: [],
  }[flags.agentFile];
  for (const [name, content] of agentFiles)
    op(`write ${path.join(ws, name)}`, () =>
      fs.writeFileSync(path.join(ws, name), content),
    );
  op(`create ${path.join(ws, "notes")}/`, () => {
    fs.mkdirSync(path.join(ws, "notes"));
    fs.writeFileSync(path.join(ws, "notes", "README.md"), tmplNotesReadme(repo));
  });
  op(`create ${path.join(ws, "scratch")}/`, () => {
    fs.mkdirSync(path.join(ws, "scratch"));
    fs.writeFileSync(path.join(ws, "scratch", "README.md"), tmplScratchReadme());
  });
  if (wsGit) {
    op(`git init workspace ${ws} (repo dir and scratch/ ignored)`, () => {
      git(ws, "init", "-q");
      fs.writeFileSync(path.join(ws, ".gitignore"), tmplWorkspaceGitignore(repo));
    });
  }
}

// ----------------------------------------------------------------- commands

async function create(project) {
  if (!project)
    project = await ask("project name (workspace becomes <name>-project):");
  if (!project) fail("usage: repoyard create <project>");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project))
    fail(`invalid project name: ${project}`);

  const ws = path.resolve(`${project}-project`);
  const repoDir = path.join(ws, project);
  if (fs.existsSync(ws)) fail(`${ws} already exists`);

  await chooseAgentFile();
  const wsGit = await confirm(
    "git init the workspace itself, giving notes/ a private history?",
    false,
  );

  op(`create workspace ${ws}/`, () => fs.mkdirSync(ws));
  scaffoldWorkspace(ws, project, wsGit);
  op(`create ${repoDir}/ and git init`, () => {
    fs.mkdirSync(repoDir);
    git(repoDir, "init", "-q");
  });

  console.log(`cd ${project}-project/${project}`);
}

async function adopt() {
  const repoPath = process.cwd();
  const repoName = path.basename(repoPath);
  const dotGit = path.join(repoPath, ".git");

  let needsInit = false;
  if (!fs.existsSync(dotGit)) {
    let insideRepo = false;
    try {
      insideRepo =
        execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
          cwd: repoPath,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim() === "true";
    } catch {}
    if (insideRepo)
      fail("inside a git repo but not its root; cd to the repo root first");
    if (!(await confirm(`${repoName} is not a git repo. git init it, then adopt?`)))
      fail("not a git repo (no .git here); nothing adopted");
    needsInit = true;
  } else if (!fs.statSync(dotGit).isDirectory()) {
    fail("this is a linked worktree checkout (.git is a file); adopt the main repo instead");
  } else if (git(repoPath, "status", "--porcelain", "--untracked-files=no").trim() !== "") {
    fail("repo has uncommitted changes; commit or stash first — adopt moves the repo directory");
  }

  const ws = path.join(path.dirname(repoPath), `${repoName}-project`);
  if (fs.existsSync(ws)) fail(`${ws} already exists`);
  const newRepoPath = path.join(ws, repoName);

  await chooseAgentFile();
  const wsGit = await confirm(
    "git init the workspace itself, giving notes/ a private history?",
    false,
  );

  if (needsInit) op(`git init ${repoPath}`, () => git(repoPath, "init", "-q"));
  op(`create workspace ${ws}/`, () => fs.mkdirSync(ws));
  op(`move ${repoPath} -> ${newRepoPath}`, () => fs.renameSync(repoPath, newRepoPath));
  try {
    if (!flags.dry && process.env.REPOYARD_FAIL === "after-rename")
      throw new Error("injected test failure");
    scaffoldWorkspace(ws, repoName, wsGit);
  } catch (err) {
    fs.renameSync(newRepoPath, repoPath);
    fs.rmSync(ws, { recursive: true, force: true });
    fail(`adopt failed, rolled back (repo is back where it was): ${err.message}`);
  }

  console.log(`cd ../${repoName}-project/${repoName}`);
}

function doctor() {
  const cwd = process.cwd();
  let ws, repoName;
  if (fs.existsSync(path.join(cwd, ".git"))) {
    ws = path.dirname(cwd);
    repoName = path.basename(cwd);
  } else {
    ws = cwd;
    repoName = path.basename(ws).replace(/-project$/, "");
  }

  const checks = [
    [
      `workspace dir is named ${repoName}-project`,
      path.basename(ws) === `${repoName}-project`,
    ],
    [
      `repo dir ${repoName}/ exists in workspace and is a git repo`,
      fs.existsSync(path.join(ws, repoName, ".git")),
    ],
    [
      "agent instructions file exists (CLAUDE.md or AGENTS.md)",
      fs.existsSync(path.join(ws, "CLAUDE.md")) ||
        fs.existsSync(path.join(ws, "AGENTS.md")),
    ],
    ["notes/ exists", fs.existsSync(path.join(ws, "notes"))],
    ["scratch/ exists", fs.existsSync(path.join(ws, "scratch"))],
  ];

  // The workspace must not be committable: either outside version control
  // entirely, or its own repo with the project repo and scratch/ ignored.
  let topLevel = null;
  try {
    topLevel = git(ws, "rev-parse", "--show-toplevel").trim();
  } catch {
    /* not inside any git repo — good */
  }
  if (topLevel === null) {
    checks.push(["workspace is not inside any git repo", true]);
  } else if (topLevel === fs.realpathSync(ws)) {
    const gi = fs.existsSync(path.join(ws, ".gitignore"))
      ? fs.readFileSync(path.join(ws, ".gitignore"), "utf8")
      : "";
    checks.push([
      `workspace has its own repo and .gitignore covers /${repoName}/ and scratch/`,
      gi.includes(`/${repoName}/`) && gi.includes("scratch/"),
    ]);
  } else {
    checks.push([
      `workspace is not inside an enclosing git repo (found ${topLevel})`,
      false,
    ]);
  }

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? "ok   " : "FAIL "} ${label}`);
    if (!ok) failed++;
  }
  console.log(
    failed === 0
      ? `\nworkspace ${ws} follows the convention`
      : `\n${failed} problem(s) in ${ws}; doctor does not auto-fix`,
  );
  if (failed > 0) process.exit(1);
}

// --------------------------------------------------------------------- main

const args = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--no-input") flags.input = false;
  else if (a === "--dry-run") flags.dry = true;
  else if (a === "--agent-file") {
    flags.agentFile = argv[++i];
    flags.agentFileSet = true;
  } else if (a.startsWith("--agent-file=")) {
    flags.agentFile = a.slice("--agent-file=".length);
    flags.agentFileSet = true;
  }
  else if (a === "-h" || a === "--help") {
    console.log(USAGE);
    process.exit(0);
  } else if (a.startsWith("-")) fail(`unknown flag: ${a}\n\n${USAGE}`);
  else args.push(a);
}
if (!["claude", "agents", "both", "none"].includes(flags.agentFile))
  fail(`--agent-file must be claude, agents, both, or none (got: ${flags.agentFile})`);

let [cmd, ...rest] = args;
if (cmd === undefined && interactive()) {
  console.log(USAGE);
  cmd = await select("command:", ["create", "adopt", "doctor"]);
}
if (cmd === "create") await create(rest[0]);
else if (cmd === "adopt") await adopt();
else if (cmd === "doctor") doctor();
else {
  console.log(USAGE);
  process.exit(cmd === undefined ? 0 : 1);
}
