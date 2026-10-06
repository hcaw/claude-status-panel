#!/usr/bin/env python3
"""Gathers the status-panel figures the engine does not hand a mod directly.

Reads {"cwd", "session_id"} on stdin and prints one JSON object: git branch and
extras, the Env line, the account's plan and email, and the session's token
totals summed from its transcript.
"""
import glob
import json
import os
import re
import subprocess
import sys

req = json.load(sys.stdin)
cwd = req.get("cwd") or os.getcwd()
sid = req.get("session_id") or ""
out = {}


def run(argv, stdin=""):
    try:
        r = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=3)
        return r.stdout
    except Exception:
        return ""


branch = run(["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]).strip()
if branch:
    out["branch"] = branch

def git(*args):
    return run(["git", "-C", cwd, *args])


def git_extras():
    """Line counts for staged and unstaged changes, then status flags:
    + staged, * unstaged, ? untracked, ! conflict. For example "(+3,-1) +*"."""
    added = removed = 0
    for numstat in (git("diff", "--numstat"), git("diff", "--cached", "--numstat")):
        for line in numstat.splitlines():
            parts = line.split("\t")
            if len(parts) >= 2:
                added += int(parts[0]) if parts[0].isdigit() else 0
                removed += int(parts[1]) if parts[1].isdigit() else 0
    staged = unstaged = untracked = conflict = False
    for line in git("status", "--porcelain").splitlines():
        if len(line) < 2:
            continue
        x, y = line[0], line[1]
        if x == "?":
            untracked = True
        elif "U" in (x, y) or x == y and x in "AD":
            conflict = True
        else:
            staged = staged or x != " "
            unstaged = unstaged or y != " "
    flags = "+" * staged + "*" * unstaged + "?" * untracked + "!" * conflict
    return f"(+{added},-{removed})" + (f" {flags}" if flags else "")


def version_of(argv):
    m = re.search(r"\d+\.\d+(?:\.\d+)?", run(argv))
    return m.group(0) if m else None


def has(*names):
    return any(os.path.exists(os.path.join(cwd, n)) for n in names)


def env_line():
    """Runtimes for the kind of project in cwd, as shell prompts show them: Node when
    there is a package.json, Python (with its virtual env) for a Python project, and
    Node alone when neither is detected."""
    parts = []
    if has("package.json"):
        parts.append(("Node", version_of(["node", "--version"])))
    venv = os.environ.get("VIRTUAL_ENV") or next(
        (os.path.join(cwd, d) for d in (".venv", "venv", "env")
         if os.path.isfile(os.path.join(cwd, d, "bin", "python"))), None)
    conda = os.environ.get("CONDA_DEFAULT_ENV")
    if venv or conda or glob.glob(os.path.join(cwd, "*.py")) or has(
            "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt",
            "Pipfile", ".python-version", "tox.ini", "environment.yml"):
        python = os.path.join(venv, "bin", "python") if venv else "python3"
        version = version_of([python, "--version"])
        name = os.path.basename(venv.rstrip("/")) if venv else conda
        parts.append(("Python", f"{version} ({name})" if version and name else version))
    if not parts:
        parts.append(("Node", version_of(["node", "--version"])))
    return " · ".join(f"{label} {v}" for label, v in parts if v)


if git("rev-parse", "--is-inside-work-tree").strip() == "true":
    out["gitExtras"] = git_extras()
env = env_line()
if env:
    out["env"] = env

try:
    with open(os.path.expanduser("~/.claude.json")) as f:
        account = json.load(f).get("oauthAccount") or {}
    org = (account.get("organizationType") or "").replace("claude_", "").replace("_", " ").strip()
    out["plan"] = ("Claude " + org.title()) if org else "Claude"
    if account.get("emailAddress"):
        out["email"] = account["emailAddress"]
except Exception:
    pass

# Token totals over the session's transcript, each message counted once.
paths = glob.glob(os.path.expanduser(f"~/.claude/projects/*/{glob.escape(sid)}.jsonl")) if sid else []
if paths:
    tin = tout = tcache = 0
    seen = set()
    with open(paths[0], errors="replace") as f:
        for line in f:
            if '"usage"' not in line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            msg = row.get("message") or {}
            usage = msg.get("usage") if isinstance(msg, dict) else None
            if not usage:
                continue
            mid = msg.get("id")
            if mid:
                if mid in seen:
                    continue
                seen.add(mid)
            tin += usage.get("input_tokens", 0) or 0
            tout += usage.get("output_tokens", 0) or 0
            tcache += (usage.get("cache_read_input_tokens", 0) or 0) + (usage.get("cache_creation_input_tokens", 0) or 0)
    out["tokens"] = {"input": tin, "output": tout, "cached": tcache, "total": tin + tout + tcache}

print(json.dumps(out))
