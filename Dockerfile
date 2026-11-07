FROM ghcr.io/astral-sh/uv:python3.12-trixie-slim
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy DATA_DIR=/app/data
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY digimv.py api.py test_digimv.py ./
RUN .venv/bin/python test_digimv.py
RUN useradd --uid 10001 --create-home app && mkdir /app/data && chown app:app /app/data
ENV PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
CMD [".venv/bin/uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
