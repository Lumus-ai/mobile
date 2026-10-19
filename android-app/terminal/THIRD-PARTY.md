# Third-party components of the terminal feature

- **proot** (static Android build from https://github.com/green-green-avk/build-proot-android, sources:
  https://github.com/green-green-avk/proot, upstream https://proot-me.github.io/): GNU GPL v2.
  Shipped unmodified as `libproot.so` and `libproot-loader.so`. The build is pinned by sha256 in
  `build-patched-apk.sh`.
- **Alpine Linux minirootfs** and **Debian bookworm-slim**: downloaded by the user on demand from the official
  servers (dl-cdn.alpinelinux.org, registry-1.docker.io), checksums verified; they carry their own licenses.
- `termsh.c`, `terminal.js`: part of this project (MIT).
