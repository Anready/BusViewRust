#!/usr/bin/env bash
# Runs on the server: installs a release archive made by deploy.sh, restarts the service,
# and rolls back to the previous version if it doesn't come up.
#
#   sudo bash server-update.sh /home/ubuntu/busview-deploy/release.tar.gz
set -euo pipefail

APP_DIR=/var/www/server
SERVICE=busview-rust
HEALTH_URL=http://127.0.0.1:8443/analytics
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-180}   # seconds; startup downloads GTFS data before it starts listening
BACKUP_DIR=/var/backups/busview
KEEP_BACKUPS=5

ARCHIVE=${1:?usage: server-update.sh <release.tar.gz>}

if [ "$(id -u)" -ne 0 ]; then
    exec sudo bash "$0" "$@"
fi

log() { printf '\033[1;34m[server]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[server] %s\033[0m\n' "$*" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

log "Unpacking $(basename "$ARCHIVE")"
tar xzf "$ARCHIVE" -C "$WORK"
[ -f "$WORK/BusView-Rust" ] || fail "BusView-Rust is missing from the archive"
head -c 4 "$WORK/BusView-Rust" | grep -q 'ELF' || fail "BusView-Rust is not a Linux binary"

# ---------- Backup ----------
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$BACKUP_DIR/$STAMP"
mkdir -p "$BACKUP"
for item in BusView-Rust static templates .env; do
    [ -e "$APP_DIR/$item" ] && cp -a "$APP_DIR/$item" "$BACKUP/"
done
log "Backup saved to $BACKUP"

rollback() {
    printf '\033[1;31m[server] Deploy failed, restoring %s\033[0m\n' "$BACKUP" >&2
    cp -a "$BACKUP/BusView-Rust" "$APP_DIR/BusView-Rust.rollback"
    mv -f "$APP_DIR/BusView-Rust.rollback" "$APP_DIR/BusView-Rust"
    for dir in static templates; do
        if [ -d "$BACKUP/$dir" ]; then
            rm -rf "${APP_DIR:?}/$dir"
            cp -a "$BACKUP/$dir" "$APP_DIR/$dir"
        fi
    done
    [ -f "$BACKUP/.env" ] && cp -a "$BACKUP/.env" "$APP_DIR/.env"
    systemctl restart "$SERVICE" || true
    exit 1
}

# ---------- Install ----------
trap 'rollback' ERR

# Rename over the old file: the running process keeps its inode, so no "text file busy"
install -m 755 "$WORK/BusView-Rust" "$APP_DIR/BusView-Rust.new"
mv -f "$APP_DIR/BusView-Rust.new" "$APP_DIR/BusView-Rust"

# Copied over the existing folders: files that only exist on the server are kept
for dir in static templates; do
    if [ -d "$WORK/$dir" ]; then
        mkdir -p "$APP_DIR/$dir"
        cp -r "$WORK/$dir/." "$APP_DIR/$dir/"
        chmod -R a+rX "$APP_DIR/$dir"
    fi
done
log "Installed binary, static/ and templates/"

if [ -f "$WORK/analytics.env" ]; then
    line=$(grep -m1 '^ANALYTICS_PASSWORD_HASH=' "$WORK/analytics.env" || true)
    if [ -n "$line" ]; then
        touch "$APP_DIR/.env"
        # Rewrite in place (cat >) so the file keeps its owner and 600 mode
        updated=$(awk -v line="$line" '
            /^ANALYTICS_PASSWORD_HASH=/ { print line; done = 1; next }
            { print }
            END { if (!done) print line }
        ' "$APP_DIR/.env")
        printf '%s\n' "$updated" > "$APP_DIR/.env"
        log "Updated ANALYTICS_PASSWORD_HASH in .env"
    fi
fi

# ---------- Restart & health check ----------
log "Restarting $SERVICE"
systemctl restart "$SERVICE"

log "Waiting for $HEALTH_URL (up to ${HEALTH_TIMEOUT}s)"
deadline=$((SECONDS + HEALTH_TIMEOUT))
until curl -fs -o /dev/null --max-time 5 "$HEALTH_URL"; do
    if [ $SECONDS -ge $deadline ]; then
        journalctl -u "$SERVICE" -n 20 --no-pager || true
        tail -n 20 /var/log/busview_rust_error.log 2>/dev/null || true
        false   # triggers rollback
    fi
    sleep 3
done
trap - ERR
log "Service is up ($HEALTH_URL responds)"

# ---------- Cleanup ----------
ls -1dt "$BACKUP_DIR"/*/ 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf
rm -f "$ARCHIVE"
log "Done. Kept the last $KEEP_BACKUPS backups in $BACKUP_DIR"
