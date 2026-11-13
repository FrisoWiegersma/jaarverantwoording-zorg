FROM ghcr.io/astral-sh/uv:python3.12-trixie-slim
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy DATA_DIR=/app/data PYTHONPATH=/app/api
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY api/ api/
COPY tests/ tests/
RUN for t in tests/test_*.py; do .venv/bin/python "$t" || exit 1; done
RUN useradd --uid 10001 --create-home app && mkdir /app/data && chown app:app /app/data
ENV PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
CMD [".venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
