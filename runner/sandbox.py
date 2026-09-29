"""Root-side execution server for the hosted runner, reachable only by its Durable Object.

Each POST /exec runs harness.py once as nobody with rlimits in a fresh directory,
then kills every nobody process. Its output stays untrusted; the Worker judges it.
"""
import json
import os
import resource
import select
import shutil
import signal
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

NOBODY = 65534
# Mirrors deadlines.testMs in scripts/python-runner/contract.mjs.
TIMEOUT = 5
MAX_BYTES = 256 * 1024
LIMITS = [(resource.RLIMIT_CPU, 2), (resource.RLIMIT_AS, 256 << 20), (resource.RLIMIT_NPROC, 32), (resource.RLIMIT_NOFILE, 64), (resource.RLIMIT_FSIZE, 64 << 10), (resource.RLIMIT_CORE, 0)]


def limit():
    for name, value in LIMITS:
        resource.setrlimit(name, (value, value))


def sweep():
    # Kill every nobody process, including any that left the session, then reap orphans.
    pid = os.fork()
    if pid == 0:
        try:
            os.setgid(NOBODY)
            os.setuid(NOBODY)
            os.kill(-1, signal.SIGKILL)
        finally:
            os._exit(0)
    os.waitpid(pid, 0)


def execute(body):
    cwd = tempfile.mkdtemp()
    os.chown(cwd, NOBODY, NOBODY)
    process, stdout, timed_out, oversized = None, b"", False, False
    try:
        with tempfile.TemporaryFile() as stdin:
            stdin.write(body)
            stdin.seek(0)
            process = subprocess.Popen(["/usr/local/bin/python3", "-I", "-B", "/harness.py"], stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=cwd, env={"PATH": "/usr/local/bin:/usr/bin:/bin", "TMPDIR": cwd}, user=NOBODY, group=NOBODY, extra_groups=[], start_new_session=True, preexec_fn=limit)
        deadline = time.monotonic() + TIMEOUT
        while not oversized:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([process.stdout], [], [], remaining)[0]:
                timed_out = True
                break
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                break
            stdout += chunk
            oversized = len(stdout) > MAX_BYTES
        if not timed_out and not oversized:
            try:
                process.wait(max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                timed_out = True
    finally:
        sweep()
        if process:
            process.wait()
            process.stdout.close()
        while True:
            try:
                os.waitpid(-1, 0)
            except ChildProcessError:
                break
        shutil.rmtree(cwd, ignore_errors=True)
    return {"exitCode": process.returncode, "timedOut": timed_out, "oversized": oversized, "stdout": "" if oversized else stdout.decode("utf-8", "replace")}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.body()
        if self.path != "/exec" or body is None:
            return self.reply(400, {"error": "Bad request"})
        self.reply(200, execute(body))

    def body(self):
        if "chunked" not in self.headers.get("transfer-encoding", "").lower():
            length = int(self.headers.get("content-length") or 0)
            return self.rfile.read(length) if 0 < length <= MAX_BYTES else None
        data = b""
        while size := int(self.rfile.readline().split(b";")[0], 16):
            data += self.rfile.read(size)
            self.rfile.readline()
            if len(data) > MAX_BYTES:
                return None
        return data or None

    def reply(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
