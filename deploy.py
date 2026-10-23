import subprocess
import os
import sys

CWD = r"C:\Users\Monish\jarvis-os"

def run(cmd):
    print(f">> Running: {cmd}")
    res = subprocess.run(cmd, shell=True, cwd=CWD, capture_output=True, text=True)
    if res.stdout:
        print(res.stdout)
    if res.stderr:
        print(res.stderr, file=sys.stderr)
    return res.returncode

def main():
    print("=== Step 1: Initializing Git Repository ===")
    run("git init -b main")
    run("git config user.name")
    run("git config user.email")

    print("\n=== Step 2: Staging & Committing Code ===")
    run("git add .")
    run('git commit -m "feat: complete J.A.R.V.I.S. OS v7.0.1 with HUD and Vercel support"')

    print("\n=== Step 3: Creating GitHub Repository via GH CLI ===")
    # Try creating the repository on GitHub and pushing directly
    ret = run("gh repo create jarvis-os --public --source=. --remote=origin --push --description \"J.A.R.V.I.S. Autonomous Desktop Environment & Holographic HUD Operating System\"")
    
    if ret != 0:
        # If repo might already exist or remote needed
        print("Retrying push to existing origin...")
        run("git push -u origin main")

    print("\n=== Done! Checking Remote URL ===")
    run("git remote -v")

if __name__ == "__main__":
    main()
