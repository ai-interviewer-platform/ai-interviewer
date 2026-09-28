FROM python:3.12-slim-bookworm
COPY --chmod=0444 harness.py sandbox.py /
# Candidates (uid 65534) may write only to their per-run directory.
RUN chmod 0755 /tmp /var/tmp
EXPOSE 8080
ENTRYPOINT ["python3", "-I", "-B", "/sandbox.py"]
