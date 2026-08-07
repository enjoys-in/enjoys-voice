# FreeSWITCH `.deb` build (CallNet edge)

Produces a `callnet-freeswitch_<ver>_<arch>.deb` from source with a **trimmed
module set**, for **amd64 + arm64**. This is what removes the "install
FreeSWITCH manually" step from the edge appliance — and closes the arm64
(Raspberry Pi) gap, since Debian no longer ships FreeSWITCH.

## Why from source

Debian dropped FreeSWITCH from main, and SignalWire's official packages need a
personal access token (and have spotty arm64 coverage). Building from source
with a curated [`modules.conf`](modules.conf) keeps the dependency surface tiny
(only `sofia-sip` + a few codec/format libs — no libks/verto/v8/spandsp).

## Build locally

```bash
cd edge/packaging/freeswitch
PLATFORMS=linux/amd64 ./build-deb.sh            # host arch only (fast)
PLATFORMS=linux/amd64,linux/arm64 ./build-deb.sh # both (arm64 via qemu, slow)
# -> out/linux_amd64/callnet-freeswitch_*.deb, out/linux_arm64/...
```

Requires Docker with buildx. A from-source build is **~20–40 min per arch**
(arm64 under qemu is slower).

## Build in CI

[`.github/workflows/edge-freeswitch-deb.yml`](../../../.github/workflows/edge-freeswitch-deb.yml)
runs the same build per-arch on separate runners and uploads each `.deb` as an
artifact. Trigger it manually (workflow_dispatch) or on changes to this folder.

## Use it on the appliance

Drop the matching `.deb` into `edge/packages/` next to `install.sh`:

```
edge/packages/callnet-freeswitch_1.10.12_amd64.deb   # or _arm64.deb
```

`install.sh` auto-detects and installs it before deploying the config overlays —
no manual FreeSWITCH install, no SignalWire token.

## Tuning

- **Version**: `FS_VERSION=v1.10.x ./build-deb.sh` (and `SOFIA_VERSION`).
- **Modules**: edit [`modules.conf`](modules.conf). If you add a module, also add
  its build dep to the Dockerfile (e.g. `mod_spandsp` ⇒ build `spandsp` first).
- **Sounds**: baked in by default (8 kHz + MOH). `--build-arg WITH_SOUNDS=false`
  for a slim package (voicemail prompts then need a separate sounds install).
