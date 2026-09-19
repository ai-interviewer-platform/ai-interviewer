FROM python:3.12-slim-bookworm
COPY --chmod=0444 harness.py /harness.py
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python3", "-I", "-B", "/harness.py"]
