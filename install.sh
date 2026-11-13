#!/usr/bin/env bash
# Install or update Jaarverslagen Zorg with Docker:
#   curl -fsSL https://raw.githubusercontent.com/FrisoWiegersma/jaarverantwoording-zorg/main/install.sh | bash
# Asks for one AI provider key on the first run; run it again to update. JVZ_DIR picks another folder.
set -euo pipefail

# ponytail: everything sits in main, so a download cut off halfway runs nothing.
main() {
  local repo=https://github.com/FrisoWiegersma/jaarverantwoording-zorg.git
  local dir=${JVZ_DIR:-$HOME/jaarverantwoording-zorg} url=http://localhost:3210

  command -v git >/dev/null || { echo "Install git first." >&2; exit 1; }
  docker compose version >/dev/null 2>&1 ||
    { echo "Install Docker with the Compose plugin first: https://docs.docker.com/get-docker/" >&2; exit 1; }

  if [ -d "$dir/.git" ]; then
    echo "Updating $dir"
    git -C "$dir" pull -q --ff-only
  else
    echo "Downloading to $dir"
    git clone -q --depth 1 "$repo" "$dir"
  fi
  cd "$dir"

  if [ ! -f .env ]; then
    local choice var key
    echo
    echo "Which AI provider do you have a key for?"
    echo "  1) Gemini   2) Claude   3) OpenAI   4) DeepSeek (cannot read scanned pages)"
    read -rp "Choose 1-4 [1]: " choice </dev/tty
    case ${choice:-1} in
      1) var=GEMINI_API_KEY ;; 2) var=ANTHROPIC_API_KEY ;; 3) var=OPENAI_API_KEY ;; 4) var=DEEPSEEK_API_KEY ;;
      *) echo "Choose 1, 2, 3 or 4." >&2; exit 1 ;;
    esac
    read -rsp "Paste your $var (hidden): " key </dev/tty
    echo
    [ -n "$key" ] || { echo "No key given." >&2; exit 1; }
    # Drop the example's line for this key and append the real one; sed would trip over | or & in a key.
    (umask 077 && { grep -vE "^#? ?$var=" .env.example; printf '%s=%s\n' "$var" "$key"; } >.env)
    echo "Saved in $dir/.env. Ollama or another OpenAI-compatible server: see the comments there."
  fi

  echo
  echo "Building and starting; the first run takes a few minutes."
  docker compose up -d --build --wait

  echo
  echo "Ready at $url. Create an account there."
  echo "The archive index builds in the background for the first few minutes; watch it with:"
  echo "  docker compose -f $dir/compose.yaml logs -f api"
  if command -v xdg-open >/dev/null; then xdg-open "$url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null; then open "$url" || true; fi
}

main "$@"
