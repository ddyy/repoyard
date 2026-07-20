import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli.js", import.meta.url));

function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", ...env },
  });
}

function tmp() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "repoyard-"));
}

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

// Make a git repo with one commit at dir/name; returns its path.
function makeRepo(dir, name) {
  const repo = path.join(dir, name);
  fs.mkdirSync(repo);
  sh(repo, "git", ["init", "-q"]);
  fs.writeFileSync(path.join(repo, "file.txt"), "hello\n");
  sh(repo, "git", ["add", "."]);
  sh(repo, "git", [
    "-c", "user.email=t@t", "-c", "user.name=t",
    "commit", "-qm", "init",
  ]);
  return repo;
}

// ------------------------------------------------------------------- create

test("create scaffolds the full tree with a git-init'd repo", () => {
  const dir = tmp();
  const r = run(["create", "demo", "--no-input"], dir);
  assert.equal(r.status, 0, r.stderr);
  const ws = path.join(dir, "demo-workspace");
  assert.ok(fs.statSync(path.join(ws, "demo", ".git")).isDirectory());
  assert.ok(fs.readFileSync(path.join(ws, "CLAUDE.md"), "utf8").includes("demo/"));
  assert.ok(fs.existsSync(path.join(ws, "notes", "README.md")));
  assert.ok(fs.existsSync(path.join(ws, "scratch", "README.md")));
  assert.ok(!fs.existsSync(path.join(ws, ".git")), "workspace not git-init'd by default");
  assert.equal(
    fs.readFileSync(path.join(ws, ".gitignore"), "utf8"),
    "/demo/\nscratch/\n",
    "workspace .gitignore always written",
  );
  assert.ok(r.stdout.trim().endsWith("cd demo-workspace/demo"));
});

test("create refuses when the workspace already exists", () => {
  const dir = tmp();
  assert.equal(run(["create", "demo", "--no-input"], dir).status, 0);
  const r = run(["create", "demo", "--no-input"], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /already exists/);
});

test("create --dry-run prints operations and touches nothing", () => {
  const dir = tmp();
  const r = run(["create", "demo", "--dry-run"], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\] would create workspace/);
  assert.deepEqual(fs.readdirSync(dir), [], "dry-run created files");
});

test("create --agent-file selects the agent instructions file", () => {
  const dir = tmp();
  let r = run(["create", "a", "--no-input", "--agent-file=agents"], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, "a-workspace", "AGENTS.md")));
  assert.ok(!fs.existsSync(path.join(dir, "a-workspace", "CLAUDE.md")));
  assert.equal(run(["doctor"], path.join(dir, "a-workspace")).status, 0);

  r = run(["create", "b", "--no-input", "--agent-file", "both"], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.readFileSync(path.join(dir, "b-workspace", "AGENTS.md"), "utf8").includes("b/"));
  assert.equal(fs.readFileSync(path.join(dir, "b-workspace", "CLAUDE.md"), "utf8"), "@AGENTS.md\n");

  r = run(["create", "c", "--no-input", "--agent-file=none"], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(dir, "c-workspace", "CLAUDE.md")));
  assert.ok(!fs.existsSync(path.join(dir, "c-workspace", "AGENTS.md")));
  assert.ok(fs.existsSync(path.join(dir, "c-workspace", "notes")));

  r = run(["create", "d", "--no-input", "--agent-file=bogus"], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--agent-file must be/);
});

test("create rejects bad project names", () => {
  const dir = tmp();
  assert.notEqual(run(["create", "../evil", "--no-input"], dir).status, 0);
  assert.notEqual(run(["create", "--no-input"], dir).status, 0);
});

// -------------------------------------------------------------------- adopt

test("adopt wraps a clean repo and leaves its git status untouched", () => {
  const dir = tmp();
  const repo = makeRepo(dir, "foo");
  const r = run(["adopt", "--no-input"], repo);
  assert.equal(r.status, 0, r.stderr);
  const ws = path.join(dir, "foo-workspace");
  assert.ok(!fs.existsSync(repo), "original repo dir should be gone");
  assert.ok(fs.existsSync(path.join(ws, "foo", "file.txt")));
  assert.ok(fs.existsSync(path.join(ws, "CLAUDE.md")));
  assert.ok(fs.existsSync(path.join(ws, "notes")));
  assert.ok(fs.existsSync(path.join(ws, "scratch")));
  assert.equal(sh(path.join(ws, "foo"), "git", ["status", "--porcelain"]), "");
  assert.ok(r.stdout.trim().endsWith("cd ../foo-workspace/foo"));
});

test("adopt --dry-run plans the move but touches nothing", () => {
  const dir = tmp();
  const repo = makeRepo(dir, "foo");
  const r = run(["adopt", "--dry-run"], repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\] would move/);
  assert.ok(fs.existsSync(repo));
  assert.ok(!fs.existsSync(path.join(dir, "foo-workspace")));
});

test("adopt refuses a dirty tree", () => {
  const dir = tmp();
  const repo = makeRepo(dir, "foo");
  fs.writeFileSync(path.join(repo, "file.txt"), "modified\n");
  const r = run(["adopt", "--no-input"], repo);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /uncommitted changes/);
  assert.ok(fs.existsSync(repo));
});

test("adopt refuses when the target workspace already exists", () => {
  const dir = tmp();
  const repo = makeRepo(dir, "foo");
  fs.mkdirSync(path.join(dir, "foo-workspace"));
  const r = run(["adopt", "--no-input"], repo);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /already exists/);
  assert.ok(fs.existsSync(path.join(repo, "file.txt")));
});

test("adopt refuses outside a repo root", () => {
  const dir = tmp();
  const repo = makeRepo(dir, "foo");
  const sub = path.join(repo, "sub");
  fs.mkdirSync(sub);
  const r = run(["adopt", "--no-input"], sub);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not its root/);
});

test("adopt refuses a non-repo dir under --no-input, leaving it untouched", () => {
  const dir = tmp();
  const plain = path.join(dir, "plain");
  fs.mkdirSync(plain);
  const r = run(["adopt", "--no-input"], plain);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a git repo/);
  assert.ok(!fs.existsSync(path.join(plain, ".git")), "must not git init without consent");
  assert.ok(!fs.existsSync(path.join(dir, "plain-workspace")));
});

test("adopt refuses a linked worktree checkout", () => {
  const dir = tmp();
  const wt = path.join(dir, "foo");
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, ".git"), "gitdir: /somewhere/else\n");
  const r = run(["adopt", "--no-input"], wt);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /worktree/);
});

test("adopt rolls back the rename when scaffolding fails", () => {
  const dir = tmp();
  const repo = makeRepo(dir, "foo");
  const r = run(["adopt", "--no-input"], repo, { REPOYARD_FAIL: "after-rename" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /rolled back/);
  assert.ok(fs.existsSync(path.join(repo, "file.txt")), "repo restored in place");
  assert.ok(!fs.existsSync(path.join(dir, "foo-workspace")), "workspace removed");
  assert.equal(sh(repo, "git", ["status", "--porcelain"]), "");
});

// ------------------------------------------------------------------- doctor

test("doctor passes on a freshly created workspace (from repo or workspace)", () => {
  const dir = tmp();
  run(["create", "demo", "--no-input"], dir);
  const ws = path.join(dir, "demo-workspace");
  assert.equal(run(["doctor"], path.join(ws, "demo")).status, 0);
  assert.equal(run(["doctor"], ws).status, 0);
});

test("doctor flags a hand-broken workspace", () => {
  const dir = tmp();
  run(["create", "demo", "--no-input"], dir);
  const ws = path.join(dir, "demo-workspace");
  fs.rmSync(path.join(ws, "notes"), { recursive: true });
  fs.rmSync(path.join(ws, "CLAUDE.md"));
  fs.rmSync(path.join(ws, ".gitignore"));
  const r = run(["doctor"], ws);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL +notes\/ exists/);
  assert.match(r.stdout, /FAIL +agent instructions file exists/);
  assert.match(r.stdout, /FAIL +workspace \.gitignore covers/);
  assert.match(r.stdout, /ok +scratch\/ exists/);
});

test("doctor flags a workspace committable inside an enclosing repo", () => {
  const dir = tmp();
  sh(dir, "git", ["init", "-q"]);
  run(["create", "demo", "--no-input"], dir);
  const r = run(["doctor"], path.join(dir, "demo-workspace"));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL +workspace is not inside an enclosing git repo/);
});

// --------------------------------------------------------------------- misc

test("--help exits 0, unknown command exits 1", () => {
  const dir = tmp();
  const h = run(["--help"], dir);
  assert.equal(h.status, 0);
  assert.match(h.stdout, /Usage:/);
  assert.equal(run(["bogus"], dir).status, 1);
  assert.equal(run([], dir).status, 0);
});
