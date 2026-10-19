## Deploy

From Git Bash (needs Docker Desktop and the SSH key):

```bash
./deploy/deploy.sh
```

Builds the Linux binary, shows which files will change, asks for confirmation, uploads everything and runs `deploy/server-update.sh` on the server. That script backs up the current version to `/var/backups/busview`, installs the new one, restarts `busview-rust` and rolls back automatically if the site doesn't come up. `--skip-build` reuses the last build, `-y` skips the confirmation.

Manual commands:

docker run --rm -v "${PWD}:/app" -v cargo-cache:/usr/local/cargo/registry -w /app -e PROTOC=/usr/bin/protoc rust:alpine sh -c "apk add --no-cache musl-dev perl make protobuf protobuf-dev && cargo build --release --target x86_64-unknown-linux-musl"

scp -i "D:\AProjects\IdeaProjects\demotest\demo\livebuskey.pem" .\target\x86_64-unknown-linux-musl\release\BusView-Rust ubuntu@18.184.185.96:/home/ubuntu

systemctl restart busview-rust