docker run --rm -v "${PWD}:/app" -v cargo-cache:/usr/local/cargo/registry -w /app rust:alpine sh -c "apk add --no-cache musl-dev perl make && cargo build --release --target x86_64-unknown-linux-musl"

scp -i "D:\AProjects\IdeaProjects\demotest\demo\livebuskey.pem" \target\x86_64-unknown-linux-gnu\release\BusView-Rust ubuntu@18.184.185.96:/home/ubuntu

systemctl restart busview-rust