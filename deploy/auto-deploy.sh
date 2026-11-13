#!/bin/sh
# Deploy origin/main to ~/jaarverantwoording-zorg once every GitHub check on it
# has passed. Run by jaarverantwoording-deploy.timer; start it by hand with
# `systemctl --user start jaarverantwoording-deploy` so two runs never overlap.
# A failed build or health check rolls back to the previous commit and skips the
# bad commit until a newer one lands (or `rm .git/deploy-failed` to retry it).
set -eu

# ponytail: the braces make sh read the whole script before running it, because
# the merge below can rewrite this file mid-run.
{
cd "$HOME/jaarverantwoording-zorg"
failed=.git/deploy-failed

git fetch -q origin main
new=$(git rev-parse origin/main)
old=$(git rev-parse HEAD)
[ "$new" = "$old" ] && exit 0
[ "$(cat "$failed" 2>/dev/null)" = "$new" ] && exit 0

# Public repo, so no token; this only runs while main is ahead, well under the 60 calls/hour limit.
curl -fsS "https://api.github.com/repos/FrisoWiegersma/jaarverantwoording-zorg/commits/$new/check-runs" \
  | jq -e '.total_count > 0 and all(.check_runs[]; .status == "completed" and (.conclusion == "success" or .conclusion == "skipped"))' \
    >/dev/null || exit 0  # checks pending or failed

deploy() { APP_VERSION=$(git rev-parse --short HEAD) docker compose up -d --wait "$@"; }

echo "deploying $new (was $old)"
git merge -q --ff-only "$new"
if deploy --build; then
  echo "deployed $new"
else
  echo "deploy of $new failed, rolling back to $old"
  echo "$new" > "$failed"
  git reset -q --keep "$old"
  deploy --no-build
  exit 1
fi

# Keep the running tag plus the four newest others per service, for rollbacks.
current=$(git rev-parse --short HEAD)
for image in jaarverantwoording-zorg-api jaarverantwoording-zorg-web; do
  docker images --format '{{.Repository}}:{{.Tag}}' "$image" | grep -v ":$current\$" | tail -n +5 \
    | xargs -r docker rmi >/dev/null 2>&1 || true
done
exit
}
