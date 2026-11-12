FROM ghcr.io/astral-sh/uv:python3.12-trixie-slim
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy DATA_DIR=/app/data
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY digimv.py sources.py documents.py datasets.py api.py projects.py test_digimv.py test_sources.py test_documents.py test_projects.py ./
RUN .venv/bin/python test_digimv.py && .venv/bin/python test_sources.py && .venv/bin/python test_documents.py && .venv/bin/python test_projects.py
RUN useradd --uid 10001 --create-home app && mkdir /app/data && chown app:app /app/data
ENV PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
CMD [".venv/bin/uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
