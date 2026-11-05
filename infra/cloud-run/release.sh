#!/usr/bin/env bash
# Builds, stages and promotes the pilot's two Cloud Run services.
#
#   infra/cloud-run/release.sh build            # API and web images for HEAD
#   infra/cloud-run/release.sh stage api|web    # new revision: no traffic, own tagged URL
#   infra/cloud-run/release.sh promote api|web  # send all traffic to that revision
#
# The release is named launch-<short commit of HEAD>; set AIRBOARD_RELEASE to
# stage or promote another one (a rollback is `AIRBOARD_RELEASE=launch-<hash>
# release.sh promote api`). Smoke a staged revision on its tagged URL before
# promoting it, and apply migrations (`supabase db push`) before promoting an
# API that needs them. DRY_RUN=1 prints the commands instead of running them.
#
# Needs gcloud signed in to the pilot project and the Supabase CLI signed in
# (the web build reads the project's publishable key, which is public).
set -euo pipefail
cd "$(dirname "$0")/../.."

PROJECT=project-1217dd57-9cac-491d-b8d
REGION=asia-south1
REGISTRY=$REGION-docker.pkg.dev/$PROJECT/airboard-pilot
BUILD_ACCOUNT=projects/$PROJECT/serviceAccounts/634900453473-compute@developer.gserviceaccount.com
API_URL=https://airboard-pilot-api-634900453473.asia-south1.run.app
SUPABASE_REF=ujotgzjpkocuhtfrvbzu
MEET_PROJECT_NUMBER=634900453473
# Placeholder until the Chrome Web Store item is reviewed; the Meet extension
# is a private preview loaded unpacked.
CHROME_EXTENSION_ID=${CHROME_EXTENSION_ID:-abcdefghijklmnopabcdefghijklmnop}
CHROME_EXTENSION_VERSION=0.8.0

RELEASE=${AIRBOARD_RELEASE:-launch-$(git rev-parse --short=7 HEAD)}

run() {
  if [[ -n ${DRY_RUN:-} ]]; then
    echo "+ $*"
  else
    "$@"
  fi
}

service_for() {
  case ${1:-} in
    api | web) echo "airboard-pilot-$1" ;;
    *) echo "usage: $0 stage|promote api|web" >&2; exit 2 ;;
  esac
}

build() {
  # gcloud uploads the working tree, so the image must match a commit.
  # next-env.d.ts is rewritten by every local Next build and is never committed.
  if [[ -z ${DRY_RUN:-} ]] && git status --porcelain --untracked-files=no | grep -v ' apps/web/next-env.d.ts$' | grep -q .; then
    echo "Commit or stash tracked changes first; the build would not match $RELEASE." >&2
    exit 1
  fi
  local key="<publishable key>"
  if [[ -z ${DRY_RUN:-} ]]; then
    key=$(supabase projects api-keys --project-ref "$SUPABASE_REF" -o json 2>/dev/null |
      python3 -c "import json,sys;print([k['api_key'] for k in json.load(sys.stdin) if k.get('type')=='publishable'][0])")
    [[ $key == sb_publishable_* ]] || { echo "Could not read the Supabase publishable key." >&2; exit 1; }
  fi
  local logs=${TMPDIR:-/tmp}
  echo "Building $RELEASE; logs in $logs/airboard-$RELEASE-{api,web}.log"
  run gcloud builds submit . --project="$PROJECT" --service-account="$BUILD_ACCOUNT" \
    --config=infra/cloud-run/cloudbuild-api.yaml \
    --substitutions="_IMAGE=$REGISTRY/api:$RELEASE" >"$logs/airboard-$RELEASE-api.log" 2>&1 &
  local api=$!
  run gcloud builds submit . --project="$PROJECT" --service-account="$BUILD_ACCOUNT" \
    --config=infra/cloud-run/cloudbuild-web.yaml \
    --substitutions="_IMAGE=$REGISTRY/web:$RELEASE,_AIRBOARD_API_URL=$API_URL,_GOOGLE_MEET_CLOUD_PROJECT_NUMBER=$MEET_PROJECT_NUMBER,_SUPABASE_URL=https://$SUPABASE_REF.supabase.co,_SUPABASE_ANON_KEY=$key,_AIRBOARD_CHROME_EXTENSION_ID=$CHROME_EXTENSION_ID,_CHROME_EXTENSION_VERSION=$CHROME_EXTENSION_VERSION,_CHROME_EXTENSION_COMPATIBLE_VERSIONS=$CHROME_EXTENSION_VERSION" \
    >"$logs/airboard-$RELEASE-web.log" 2>&1 &
  local web=$!
  local failed=0
  wait $api || { echo "API build failed" >&2; failed=1; }
  wait $web || { echo "Web build failed" >&2; failed=1; }
  [[ -n ${DRY_RUN:-} ]] && cat "$logs/airboard-$RELEASE-api.log" "$logs/airboard-$RELEASE-web.log"
  return $failed
}

stage() {
  local service
  service=$(service_for "$1")
  # The API shares live boards across instances (board event fan-out), so it
  # may scale out; the web stays on one. The services keep a minimum of one
  # warm instance at the service level, which applies only to revisions
  # serving traffic, so staged revisions don't hold idle instances.
  local max=1 health=/favicon.ico
  [[ $1 == api ]] && max=3 health=/health
  # A revision counts as started only once it answers HTTP, and an instance
  # that stops answering for 90 seconds is restarted.
  run gcloud run deploy "$service" --project="$PROJECT" --region="$REGION" \
    --image="$REGISTRY/$1:$RELEASE" --revision-suffix="$RELEASE" --tag="$RELEASE-$1" \
    --no-traffic --min-instances=default --max-instances="$max" \
    --startup-probe="httpGet.path=$health,periodSeconds=2,timeoutSeconds=2,failureThreshold=30" \
    --liveness-probe="httpGet.path=$health,periodSeconds=30,timeoutSeconds=5,failureThreshold=3" \
    --quiet
  echo "Staged at https://$RELEASE-$1---$service-efs77okmmq-el.a.run.app"
}

promote() {
  local service
  service=$(service_for "$1")
  # Traffic is pinned to named revisions, so a deploy alone never moves it.
  run gcloud run services update-traffic "$service" --project="$PROJECT" --region="$REGION" \
    --to-revisions="$service-$RELEASE=100" --quiet
  # The registry's cleanup policy deletes images older than 3 days beyond the
  # 10 newest, but keeps the one tagged `live`, so move that tag to the image
  # now serving. A tagging failure only warns: traffic has already moved.
  local image
  image=$(gcloud run revisions describe "$service-$RELEASE" --project="$PROJECT" --region="$REGION" \
    --format="value(spec.containers[0].image)" 2>/dev/null || true)
  if [[ -n $image ]]; then
    run gcloud artifacts docker tags add "$image" "$REGISTRY/$1:live" --quiet ||
      echo "Warning: could not tag $image as live; tag it by hand so cleanup keeps it." >&2
  fi
  [[ -n ${DRY_RUN:-} ]] && return
  gcloud run services describe "$service" --project="$PROJECT" --region="$REGION" --format=json |
    python3 -c 'import json,sys;[print("serving", t["percent"], "%", t["revisionName"]) for t in json.load(sys.stdin)["status"]["traffic"] if t.get("percent")]'
}

case ${1:-} in
  build) build ;;
  stage) stage "${2:-}" ;;
  promote) promote "${2:-}" ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
