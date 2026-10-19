#!/usr/bin/env bash
# Builds the Linux binary, uploads it with static/ and templates/, and runs server-update.sh on the server.
# Run from Git Bash on Windows (Docker Desktop must be installed):
#
#   ./deploy/deploy.sh               build, show what changes, ask, deploy
#   ./deploy/deploy.sh --skip-build  reuse the last built binary
#   ./deploy/deploy.sh -y            don't ask for confirmation
#
# Overrides: DEPLOY_HOST, DEPLOY_KEY
set -euo pipefail

HOST=${DEPLOY_HOST:-ubuntu@18.184.185.96}
KEY=${DEPLOY_KEY:-/d/AProjects/IdeaProjects/demotest/demo/livebuskey.pem}
APP_DIR=/var/www/server   # must match server-update.sh
REMOTE_TMP=busview-deploy
TARGET=x86_64-unknown-linux-musl

SKIP_BUILD=0
ASSUME_YES=0
for arg in "$@"; do
    case $arg in
        --skip-build) SKIP_BUILD=1 ;;
        -y|--yes) ASSUME_YES=1 ;;
        -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
        *) echo "Unknown option: $arg" >&2; exit 2 ;;
    esac
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

log() { printf '\033[1;32m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }

SSH_OPTS=(-i "$KEY" -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
[ -f "$KEY" ] || fail "SSH key not found: $KEY"

# ---------- Build ----------
BINARY="target/$TARGET/release/BusView-Rust"
if [ $SKIP_BUILD -eq 0 ]; then
    if ! docker info >/dev/null 2>&1; then
        log "Starting Docker Desktop"
        cmd //c start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" >/dev/null 2>&1 || true
        for _ in $(seq 1 90); do docker info >/dev/null 2>&1 && break; sleep 2; done
        docker info >/dev/null 2>&1 || fail "Docker is not running"
    fi

    log "Building $TARGET release (first build takes a few minutes)"
    # pwd -W gives a Windows path Docker understands; MSYS_NO_PATHCONV stops Git Bash from mangling /app
    MSYS_NO_PATHCONV=1 docker run --rm \
        -v "$(pwd -W):/app" \
        -v cargo-cache:/usr/local/cargo/registry \
        -w /app \
        -e PROTOC=/usr/bin/protoc \
        rust:alpine \
        sh -c "apk add --no-cache -q musl-dev perl make protobuf protobuf-dev && cargo build --release --target $TARGET"
fi
[ -f "$BINARY" ] || fail "$BINARY not found, run without --skip-build"

# ---------- Package ----------
STAGE=target/deploy/stage
ARCHIVE=target/deploy/release.tar.gz
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp "$BINARY" "$STAGE/BusView-Rust"
cp -r static templates "$STAGE/"
grep -m1 '^ANALYTICS_PASSWORD_HASH=' .env > "$STAGE/analytics.env" 2>/dev/null || rm -f "$STAGE/analytics.env"
tar czf "$ARCHIVE" -C "$STAGE" .
log "Packed $(du -h "$ARCHIVE" | cut -f1) archive"

# ---------- Preview ----------
log "Comparing with $HOST:$APP_DIR"
LOCAL_SUMS=$(cd "$STAGE" && find BusView-Rust static templates -type f -exec md5sum {} + | sed 's/ \*/  /' | sort -k2)
REMOTE_SUMS=$(ssh -n "${SSH_OPTS[@]}" "$HOST" "cd '$APP_DIR' && find BusView-Rust static templates -type f -exec md5sum {} + 2>/dev/null | sort -k2" || true)

CHANGES=$(join -1 2 -2 2 -a 1 -e MISSING -o 0,1.1,2.1 \
    <(printf '%s\n' "$LOCAL_SUMS" | awk '{print $1, $2}' | sort -k2) \
    <(printf '%s\n' "$REMOTE_SUMS" | awk '{print $1, $2}' | sort -k2) |
    awk '$3 == "MISSING" { print "  + " $1; next } $2 != $3 { print "  ~ " $1 }')
SERVER_ONLY=$(comm -13 \
    <(printf '%s\n' "$LOCAL_SUMS" | awk '{print $2}' | sort) \
    <(printf '%s\n' "$REMOTE_SUMS" | awk '{print $2}' | sort) | sed 's/^/  = /')

if [ -z "$CHANGES" ]; then
    log "Server already has exactly these files"
else
    echo "Will be updated (+ new, ~ changed):"
    echo "$CHANGES"
fi
if [ -n "$SERVER_ONLY" ]; then
    echo "Only on the server (kept as is):"
    echo "$SERVER_ONLY"
fi
[ -f "$STAGE/analytics.env" ] && echo "ANALYTICS_PASSWORD_HASH from local .env will be written to the server .env"

if [ $ASSUME_YES -eq 0 ]; then
    read -r -p "Deploy to $HOST? [y/N] " answer || answer=""
    [[ $answer =~ ^[YyДд] ]] || fail "Cancelled"
fi

# ---------- Upload & install ----------
log "Uploading"
ssh -n "${SSH_OPTS[@]}" "$HOST" "mkdir -p ~/$REMOTE_TMP"
# Strip CRLF in case git checked the script out with Windows line endings
sed 's/\r$//' deploy/server-update.sh > target/deploy/server-update.sh
scp "${SSH_OPTS[@]}" -q "$ARCHIVE" target/deploy/server-update.sh "$HOST:~/$REMOTE_TMP/"

log "Installing on the server"
ssh "${SSH_OPTS[@]}" -t "$HOST" "sudo bash ~/$REMOTE_TMP/server-update.sh ~/$REMOTE_TMP/release.tar.gz"

log "Deployed. Analytics: https://limassolbus.online/analytics"
