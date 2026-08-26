#!/usr/bin/env python3
"""A wizard: walks a human through a manual procedure step by step.

Everything above the "STAGES" marker is the wizard library: stage-by-stage
progress, confirmation gates, cross-platform URL opening (including WSL),
hidden secret entry, idempotent .env upserts, and `gh secret`/`gh variable`
writes. It's meant to stay identical across future wizards. Author only
the STAGES section (inside main()) below the marker.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import webbrowser
from getpass import getpass
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Wizard library, identical across every wizard; don't hand-edit this part.
# ---------------------------------------------------------------------------

_IS_TTY = sys.stdout.isatty()
_COLOR = _IS_TTY and not os.environ.get("NO_COLOR") and os.environ.get("TERM") != "dumb"


def _c(code: str) -> str:
    return code if _COLOR else ""


BOLD, DIM, RESET = _c("\033[1m"), _c("\033[2m"), _c("\033[0m")
BLUE, GREEN, YELLOW = _c("\033[34m"), _c("\033[32m"), _c("\033[33m")

# .env.production specifically, not .env. Vite only loads
# .env.production in "production" mode (plain `npm run build`), so local
# dev/test commands (npm run dev, test:e2e, test:rules), which build/run
# in other modes on purpose, keep defaulting to the emulator regardless
# of this file existing. A bare `.env` would instead apply to every
# mode, silently pointing local dev at the real project too; see
# .env.production.example and docs/adr/0006.
ENV_FILE = Path(os.environ.get("ENV_FILE", ".env.production"))
WRITTEN_ENV: list[str] = []
WRITTEN_SECRET: list[str] = []
SKIPPED: list[str] = []

_stage_index = 0
_total_stages = 0


def _clear() -> None:
    if _IS_TTY:
        print("\033[2J\033[3J\033[H", end="")


def banner(title: str, total_stages: int) -> None:
    global _total_stages
    _total_stages = total_stages
    _clear()
    print(f"\n{BOLD}{BLUE}  {title}{RESET}")
    print(f"{DIM}  {total_stages} stages{RESET}\n")
    print(f"{DIM}  You drive the browser; this wizard tells you exactly what to do and")
    print("  captures the values you copy back. Stop any time with Ctrl-C and re-run")
    print(f"  later; it remembers values already saved.{RESET}")
    pause("Ready to start?")


def stage(name: str) -> None:
    global _stage_index
    _clear()
    _stage_index += 1
    print(f"\n{BOLD}{BLUE}▸ Stage {_stage_index}/{_total_stages} · {name}{RESET}")


def say(msg: str) -> None:
    print(f"  {msg}")


def step(msg: str) -> None:
    print(f"  {BLUE}•{RESET} {msg}")


def note(msg: str) -> None:
    print(f"  {DIM}{msg}{RESET}")


def warn(msg: str) -> None:
    print(f"  {YELLOW}⚠ {msg}{RESET}")


def _is_wsl() -> bool:
    if os.environ.get("WSL_DISTRO_NAME"):
        return True
    try:
        return "microsoft" in Path("/proc/version").read_text().lower()
    except OSError:
        return False


def open_url(url: str) -> None:
    print(f"  {GREEN}↗ opening{RESET} {url}")
    if _is_wsl():
        try:
            subprocess.run(["explorer.exe", url], capture_output=True, check=False)
            return
        except FileNotFoundError:
            pass
    try:
        if webbrowser.open(url):
            return
    except Exception:
        pass
    warn(f"couldn't open a browser; visit it manually: {url}")


def pause(msg: str = "Press Enter to continue") -> None:
    try:
        input(f"  {DIM}{msg}{RESET} ")
    except EOFError:
        print()


def confirm(question: str) -> bool:
    try:
        reply = input(f"  {YELLOW}? {question}{RESET} [y/N] ")
    except EOFError:
        print()
        return False
    return reply.strip().lower().startswith("y")


def _existing(key: str) -> Optional[str]:
    if not ENV_FILE.exists():
        return None
    pattern = re.compile(rf"^{re.escape(key)}=(.*)$")
    value: Optional[str] = None
    for line in ENV_FILE.read_text().splitlines():
        match = pattern.match(line)
        if match:
            value = match.group(1)  # last match wins, same as the bash `tail -n1`
    return value


def ask(key: str, prompt: str) -> str:
    current = _existing(key)
    suffix = f" {DIM}[Enter keeps current]{RESET}" if current else ""
    try:
        value = input(f"  {BOLD}{prompt}{RESET}{suffix} ")
    except EOFError:
        value = ""
    return value or current or ""


def ask_secret(key: str, prompt: str) -> str:
    current = _existing(key)
    suffix = f" {DIM}[Enter keeps current]{RESET}" if current else ""
    try:
        value = getpass(f"  {BOLD}{prompt}{RESET}{suffix} ")
    except EOFError:
        value = ""
    return value or current or ""


def write_env(key: str, value: str) -> None:
    lines: list[str] = []
    if ENV_FILE.exists():
        pattern = re.compile(rf"^{re.escape(key)}=")
        lines = [line for line in ENV_FILE.read_text().splitlines() if not pattern.match(line)]
    lines.append(f"{key}={value}")
    ENV_FILE.write_text("\n".join(lines) + "\n")
    WRITTEN_ENV.append(key)
    print(f"  {GREEN}✓ wrote{RESET} {key} → {ENV_FILE}")


def _gh_ready() -> bool:
    try:
        subprocess.run(["gh", "auth", "status"], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def set_secret(name: str, value: str) -> None:
    if _gh_ready():
        try:
            subprocess.run(["gh", "secret", "set", name], input=value, text=True, capture_output=True, check=True)
            WRITTEN_SECRET.append(name)
            print(f"  {GREEN}✓ set{RESET} GitHub secret {name}")
            return
        except subprocess.CalledProcessError:
            pass
    SKIPPED.append(f"GitHub secret {name} (set it manually: gh secret set {name})")
    warn(f"skipped GitHub secret {name}: gh not ready; set it later")


def set_var(name: str, value: str) -> None:
    if _gh_ready():
        try:
            subprocess.run(["gh", "variable", "set", name, "--body", value], capture_output=True, check=True)
            print(f"  {GREEN}✓ set{RESET} GitHub variable {name}")
            return
        except subprocess.CalledProcessError:
            pass
    SKIPPED.append(f"GitHub variable {name}")
    warn(f"skipped GitHub variable {name}: gh not ready; set it later")


def finish() -> None:
    _clear()
    print(f"\n{BOLD}{GREEN}  ✓ Setup complete{RESET}")
    if WRITTEN_ENV:
        note(f"wrote {len(WRITTEN_ENV)} value(s) to {ENV_FILE}: {', '.join(WRITTEN_ENV)}")
    if WRITTEN_SECRET:
        note(f"set {len(WRITTEN_SECRET)} GitHub secret(s): {', '.join(WRITTEN_SECRET)}")
    if SKIPPED:
        print()
        warn("still to do by hand:")
        for item in SKIPPED:
            note(f"  - {item}")
    print()


def run(*args: str) -> bool:
    """Runs a command with output visible (unlike the capture_output helpers
    above), for the long-running/interactive steps (npm, firebase login) a
    human needs to actually watch. Returns whether it succeeded."""
    try:
        subprocess.run(args, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def firebase_cmd() -> Optional[str]:
    """The firebase CLI, preferring a global install, falling back to the
    local devDependency (firebase-tools), or None if neither exists."""
    if run("firebase", "--version"):
        return "firebase"
    local = Path("node_modules/.bin/firebase")
    return str(local) if local.exists() else None


# ---------------------------------------------------------------------------
# STAGES: one real Firebase project, replacing the local emulator default
# (docs/adr/0006) so cross-device sync has somewhere real to talk to.
# ---------------------------------------------------------------------------


def main() -> None:
    if not Path("firestore.rules").exists() or not Path("package.json").exists():
        print(
            "Run this from the times-tables-quizzer repo root "
            "(firestore.rules and package.json must be in the current directory).",
            file=sys.stderr,
        )
        sys.exit(1)

    banner("Times Tables Quizzer: Firebase project setup", total_stages=6)

    stage("Create the Firebase project")
    say("Everything so far (firebase.json, firestore.rules, cloudSync.ts) talks only")
    say("to a local emulator. This stage creates the real, hosted project behind it.")
    open_url("https://console.firebase.google.com/")
    step("Click 'Add project' / 'Create a project'.")
    step("Name it anything, e.g. 'times-tables-quizzer'. Firebase will append a")
    step("  random suffix to the actual project ID if that name's taken, which is")
    step("  completely fine; you'll copy the real ID from the console in a later step.")
    step("Decline Google Analytics when asked (this app doesn't use it) and finish")
    step("  project creation.")
    pause("Project created and you're looking at its Firebase console home?")

    stage("Enable Cloud Firestore")
    say("This is the database the shared Profile documents live in.")
    step("In the left sidebar: Build > Firestore Database.")
    step("Click 'Create database'.")
    step("Choose 'Start in production mode'. firestore.rules already has real")
    step("  access-control logic committed in this repo, not the wide-open")
    step("  test-mode default, so production mode is the right starting point.")
    step("Pick any region. This is a single-family app, so the closest one to you")
    step("  is fine and the choice barely matters.")
    pause("Firestore database created?")

    stage("Enable Anonymous Authentication")
    say("Every device signs in anonymously (docs/adr/0006). This is a cheap bot")
    say("deterrent, not the real access control (that's the exact Profile ID, which")
    say("only a pairing link/QR code hands out).")
    step("In the left sidebar: Build > Authentication.")
    step("Click 'Get started' if this is the first time you've opened Authentication.")
    step("Go to the 'Sign-in method' tab.")
    step("Click 'Anonymous' in the provider list, toggle Enable, and Save.")
    pause("Anonymous sign-in enabled?")

    stage("Register a Web App and capture its config")
    say("This is the one stage that produces real values: the 4 lines cloudSync.ts")
    say("needs to stop defaulting to the local emulator.")
    step("In the left sidebar: click the gear icon > Project settings (or go to")
    step("  Project Overview and click the '</>' web icon if no web app exists yet).")
    step("Under 'Your apps', register a new Web app. The nickname can be anything,")
    step("  e.g. 'times-tables-quizzer-web'. Skip Firebase Hosting if it's offered;")
    step("  this app deploys to GitHub Pages instead.")
    step("Firebase shows a firebaseConfig object. Copy each of these 4 values:")
    say("    apiKey, authDomain, projectId, appId")
    note("  (Yes, these are meant to be public. Firebase's own design puts access")
    note("   control in Firestore Security Rules, not in hiding this config. See")
    note("   docs/adr/0006's security/cost section.)")
    api_key = ask("VITE_FIREBASE_API_KEY", "Paste apiKey:")
    auth_domain = ask("VITE_FIREBASE_AUTH_DOMAIN", "Paste authDomain:")
    project_id = ask("VITE_FIREBASE_PROJECT_ID", "Paste projectId:")
    app_id = ask("VITE_FIREBASE_APP_ID", "Paste appId:")
    write_env("VITE_FIREBASE_API_KEY", api_key)
    write_env("VITE_FIREBASE_AUTH_DOMAIN", auth_domain)
    write_env("VITE_FIREBASE_PROJECT_ID", project_id)
    write_env("VITE_FIREBASE_APP_ID", app_id)
    say("Also publishing these as GitHub repo *variables* (not secrets; see the")
    say("note above) so the live GitHub Pages build can use real sync too, not just")
    say("local dev. .github/workflows/ci.yml's deploy step already reads these.")
    set_var("VITE_FIREBASE_API_KEY", api_key)
    set_var("VITE_FIREBASE_AUTH_DOMAIN", auth_domain)
    set_var("VITE_FIREBASE_PROJECT_ID", project_id)
    set_var("VITE_FIREBASE_APP_ID", app_id)

    stage("Point the Firebase CLI at this project and deploy the security rules")
    say("firestore.rules in this repo is already written and already tested")
    say("(firestore-tests/rules.test.ts). This stage just ships it to the real")
    say("project. Nothing to write by hand.")
    firebase = firebase_cmd()
    if not firebase:
        warn("firebase-tools not found. Run 'npm install' in the repo root first, then re-run this stage.")
    else:
        say(f"About to run: {firebase} login (skip if already logged in), then")
        say(f"  {firebase} use --add")
        say(f"  {firebase} deploy --only firestore:rules")
        if confirm("Run these now?"):
            run(firebase, "login")
            step("When prompted by 'use --add': pick the project you just created, and give")
            step("  it any alias (e.g. 'production'); 'default' also works fine.")
            if run(firebase, "use", "--add") and run(firebase, "deploy", "--only", "firestore:rules"):
                note("Rules deployed.")
            else:
                SKIPPED.append("firebase use --add && firebase deploy --only firestore:rules (something failed above; re-run by hand)")
        else:
            SKIPPED.append("firebase login && firebase use --add && firebase deploy --only firestore:rules (run by hand later)")

    stage("Verify")
    say("Checks that .env.production's new values produce a working build.")
    say("Does NOT start the preview server here, so this wizard can still show its")
    say("closing summary afterward rather than blocking on a long-running process.")
    if confirm("Run 'npm run build' now?"):
        if run("npm", "run", "build"):
            note("Build succeeded with the real config.")
        else:
            SKIPPED.append("npm run build failed; check the error above before trusting .env.production")
    else:
        note("Skipped. You can build any time with: npm run build")
    say("To actually verify sync end-to-end:")
    step("Run: npm run preview")
    step("Open the printed URL, tap 'Sync across devices' > 'Start sharing'.")
    step("Check the Firebase console's Firestore data tab for a real profiles/{id}")
    step("  document.")
    open_url("https://console.firebase.google.com/project/_/firestore/data")

    finish()
    note("Local dev (.env.production) and the live GitHub Pages deploy (repo variables) are both")
    note("wired to the real project now. Emulator-based dev/tests (npm run dev with")
    note("the emulator running, npm run test:rules, npm run test:e2e) are untouched.")
    note("They still default to the emulator project regardless of .env.production; see the ADR.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInterrupted. Re-run any time; saved values are kept.")
        sys.exit(130)
