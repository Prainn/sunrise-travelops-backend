#!/usr/bin/env python3
"""Create a verified environment backup, then retain its newest five archives."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import time
from datetime import datetime, timezone


def newest(paths):
    return sorted(paths, key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)


def rotate(directory, pattern):
    removed = []
    for path in newest(directory.glob(pattern))[5:]:
        if path.is_symlink() or not path.is_file():
            raise RuntimeError(f"Unexpected backup path: {path}")
        path.unlink()
        removed.append(str(path))
    return removed


def backup(environment):
    base = Path(f"/opt/sunrise-travelops-{environment}")
    directory = Path(f"/opt/backups/sunrise-travelops-{environment}")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    compose = ["docker", "compose", "--env-file", "server.env", "-f", "compose.ecs.yml"]
    config = ["compose.ecs.yml", "server.env", "frontend/current",
              "frontend/last-deployment.json", "backend/state.json", "backend/releases"]
    if environment == "dev":
        compose += ["-f", "compose.dev.yml"]
        config += ["compose.dev.yml", "postgres", "postgres-tls"]
    compose += ["--project-name", f"sunrise-travelops-{environment}"]
    identity = subprocess.check_output(
        compose + ["exec", "-T", "postgres", "psql", "-U", "travelops",
                   "-d", f"travelops_{environment}", "-Atc", "SELECT current_database()"],
        cwd=base, text=True).strip()
    if identity != f"travelops_{environment}":
        raise RuntimeError("Database identity mismatch")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    dump = directory / f"{environment}-{stamp}.dump"
    archive = directory / f"{environment}-{stamp}-config.tar.gz"
    partial_dump = dump.with_name(dump.name + ".partial")
    partial_archive = archive.with_name(archive.name + ".partial")
    published = False
    try:
        with partial_dump.open("xb") as output:
            subprocess.run(compose + ["exec", "-T", "postgres", "pg_dump", "-U",
                           "travelops", "-d", identity, "-Fc"], cwd=base,
                           stdout=output, check=True)
            output.flush()
            os.fsync(output.fileno())
        if partial_dump.stat().st_size == 0:
            raise RuntimeError("Empty database backup")
        # --file reads and decompresses every data block without executing SQL.
        for options in (["--list"], ["--file=/dev/null"]):
            with partial_dump.open("rb") as source:
                subprocess.run(compose + ["exec", "-T", "postgres", "pg_restore"]
                               + options, cwd=base, stdin=source,
                               stdout=subprocess.DEVNULL, check=True)
        subprocess.run(["tar", "-czf", str(partial_archive), "-C", str(base)]
                       + config + ["-C", "/opt/sunrise-travelops-ingress",
                                   "compose.ingress.yml", "nginx"], check=True)
        subprocess.run(["tar", "-tzf", str(partial_archive)],
                       stdout=subprocess.DEVNULL, check=True)
        with partial_archive.open("rb") as source:
            os.fsync(source.fileno())
        partial_archive.replace(archive)
        partial_dump.replace(dump)
        published = True
    finally:
        partial_dump.unlink(missing_ok=True)
        partial_archive.unlink(missing_ok=True)
        if not published:
            archive.unlink(missing_ok=True)

    removed_dumps = rotate(directory, f"{environment}-*.dump")
    removed_configs = rotate(directory, f"{environment}-*-config.tar.gz")
    print(json.dumps({"environment": environment, "dump": str(dump),
                      "bytes": dump.stat().st_size, "config": str(archive),
                      "removed_dumps": removed_dumps,
                      "removed_configs": removed_configs}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", choices=["dev", "prod"])
    args = parser.parse_args()
    os.umask(0o077)
    # Open the existing shared lock inode without truncating or replacing it.
    with open("/opt/sunrise-ci/build.lock", "a") as lock:
        deadline = time.monotonic() + 2700
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Shared deployment lock unavailable")
                time.sleep(1)
        backup(args.environment)


if __name__ == "__main__":
    main()
