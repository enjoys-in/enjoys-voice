# ─────────────────────────────────────────────────────────────────────────────
# Standalone FreeSWITCH (built FROM SOURCE) + mod_audio_stream + Piper neural TTS.
#
# WHY a from-source build: mod_audio_stream is a COMPILED module. It must be built
# against the FreeSWITCH headers/ABI it will run on, and our normal media image
# (safarov/freeswitch, see ../freeswitch-custom) is a *minified* rootfs with no
# compiler, headers or apt — so we can't build the module inside it. This image
# instead builds FreeSWITCH 1.10.x from source (no SignalWire token required),
# then compiles the FREE community (uni-directional) mod_audio_stream against it.
#
#   mod_audio_stream = a WebSocket *client* inside FreeSWITCH. It forks call audio
#   (L16 PCM, 8k/16k) out to a ws://… endpoint, e.g. an AI STT/VAD gateway.
#   Community edition streams audio OUT only (no playback back into the call).
#
# This image ALSO bundles Piper neural TTS via mod_tts_commandline — the same
# feature as the published mullayam06/freeswitch-piper image — wired as the default
# TTS engine so `speak`/`say` produce natural, self-hosted (no-cloud) audio.
#
# Build (slow — compiles FreeSWITCH + deps from source):
#   cd docker/freeswitch-audiostream && ./run.sh
#
# Verify:
#   docker exec <ctr> fs_cli -x 'module_exists mod_audio_stream'    # -> true
#   docker exec <ctr> fs_cli -x 'module_exists mod_tts_commandline'  # -> true
#   docker exec <ctr> fs_cli -x 'show api' | grep uuid_audio_stream
# ─────────────────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

ARG FS_VERSION=v1.10.12
ARG MOD_AUDIO_STREAM_REF=master
# Piper neural TTS (same feature set as the mullayam06/freeswitch-piper image).
ARG PIPER_VERSION=2023.11.14-2
ARG PIPER_ARCH=x86_64
ARG PIPER_VOICE=en_US-amy-medium
ARG PIPER_VOICE_PATH=en/en_US/amy/medium
# Extra voices baked alongside the default (space-separated <lang>-<voice>-<quality>
# keys; the HF path is derived from the key). Includes Hindi rohan + priyamvada.
ARG PIPER_EXTRA_VOICES="hi_IN-rohan-medium hi_IN-priyamvada-medium"
ENV DEBIAN_FRONTEND=noninteractive

# ── Toolchain + FreeSWITCH build/runtime dependencies (Debian-packaged) ──
# SignalWire's own libs (libks, signalwire-c, sofia-sip, spandsp) are NOT in
# Debian, so they are built from source below. mod_audio_stream's own extra deps
# are libssl-dev / zlib1g-dev / libevent-dev / libspeexdsp-dev (all present here).
RUN apt-get update && apt-get install -y --no-install-recommends \
      autoconf automake bison build-essential ca-certificates cmake flex git \
      libtool libtool-bin pkg-config wget \
      libssl-dev zlib1g-dev libdb-dev unixodbc-dev libncurses5-dev libexpat1-dev \
      libgdbm-dev libtiff-dev uuid-dev libpcre3-dev libedit-dev libsqlite3-dev \
      libcurl4-openssl-dev libopus-dev libsndfile1-dev libspeex-dev libspeexdsp-dev \
      libldns-dev libpng-dev libjpeg-dev libevent-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src

# ── 1. libks (SignalWire kernel/support lib — FreeSWITCH build prerequisite) ──
RUN git clone --depth 1 https://github.com/signalwire/libks.git \
 && cmake -S libks -B libks/build -DCMAKE_INSTALL_PREFIX=/usr -DCMAKE_BUILD_TYPE=Release \
 && cmake --build libks/build --target install -j"$(nproc)" \
 && ldconfig

# ── 2. signalwire-c (needs libks; required by mod_signalwire) ──
RUN git clone --depth 1 https://github.com/signalwire/signalwire-c.git \
 && cmake -S signalwire-c -B signalwire-c/build -DCMAKE_INSTALL_PREFIX=/usr -DCMAKE_BUILD_TYPE=Release \
 && cmake --build signalwire-c/build --target install -j"$(nproc)" \
 && ldconfig

# ── 3. sofia-sip (the SIP stack — mandatory FreeSWITCH core dependency) ──
RUN git clone --depth 1 https://github.com/freeswitch/sofia-sip.git \
 && cd sofia-sip && ./bootstrap.sh && ./configure --prefix=/usr \
 && make -j"$(nproc)" && make install && ldconfig

# ── 4. spandsp (DSP/fax — needed by mod_spandsp) ──
RUN git clone --depth 1 https://github.com/freeswitch/spandsp.git \
 && cd spandsp && ./bootstrap.sh && ./configure --prefix=/usr \
 && make -j"$(nproc)" && make install && ldconfig

# ── 5. FreeSWITCH itself (from source, pinned) ──
# Disable modules that need libraries we deliberately don't ship (ffmpeg/avresample,
# opencv, lame/mpg123, flite) so the build stays lean and reliable, and ENABLE
# mod_tts_commandline (off by default from source) so Piper can drive TTS.
RUN git clone --depth 1 -b "${FS_VERSION}" https://github.com/signalwire/freeswitch.git \
 && cd freeswitch \
 && sed -i -E 's@^(applications/mod_av)@#\1@; s@^(applications/mod_cv)@#\1@; s@^(formats/mod_shout)@#\1@; s@^(formats/mod_av)@#\1@; s@^(asr_tts/mod_flite)@#\1@; s@^#?(asr_tts/mod_tts_commandline)@\1@' modules.conf \
 && ./bootstrap.sh -j \
 && ./configure --prefix=/usr/local/freeswitch --disable-dependency-tracking \
 && make -j"$(nproc)" \
 && make install \
 && ldconfig

ENV PATH="/usr/local/freeswitch/bin:${PATH}"

# FreeSWITCH writes the synthesized WAV to its temp dir; make sure it exists/writable.
RUN mkdir -p /usr/local/freeswitch/tmp && chmod 1777 /usr/local/freeswitch/tmp /tmp

# ── 6. mod_audio_stream (community edition; uni-directional stream-out) ──
# pkg-config points the module's CMake at our from-source FreeSWITCH install.
RUN export PKG_CONFIG_PATH=/usr/local/freeswitch/lib/pkgconfig \
 && git clone https://github.com/amigniter/mod_audio_stream.git \
 && cd mod_audio_stream \
 && git checkout "${MOD_AUDIO_STREAM_REF}" \
 && git submodule update --init --recursive \
 && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build -j"$(nproc)" \
 && cmake --install build \
 && find /usr/local/freeswitch -name mod_audio_stream.so | grep -q .

# ── 7. Piper neural TTS (self-hosted, no cloud/keys) + mod_tts_commandline wiring ──
# Fetch the Piper binary + one voice model, then point mod_tts_commandline at it
# and make Piper the DEFAULT tts engine/voice — identical behaviour to the
# mullayam06/freeswitch-piper image, just on the from-source FreeSWITCH here.
RUN mkdir -p /opt/piper/voices \
 && wget -qO- "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_${PIPER_ARCH}.tar.gz" \
      | tar -xzC /opt/piper --strip-components=1 \
 && wget -qO "/opt/piper/voices/${PIPER_VOICE}.onnx" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/${PIPER_VOICE_PATH}/${PIPER_VOICE}.onnx" \
 && wget -qO "/opt/piper/voices/${PIPER_VOICE}.onnx.json" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/${PIPER_VOICE_PATH}/${PIPER_VOICE}.onnx.json" \
 && test -s "/opt/piper/voices/${PIPER_VOICE}.onnx" && test -x /opt/piper/piper \
 && for key in ${PIPER_EXTRA_VOICES}; do \
      lang="${key%%-*}"; rest="${key#*-}"; voice="${rest%-*}"; quality="${rest##*-}"; family="${lang%%_*}"; \
      base="https://huggingface.co/rhasspy/piper-voices/resolve/main/${family}/${lang}/${voice}/${quality}/${key}"; \
      wget -qO "/opt/piper/voices/${key}.onnx"      "${base}.onnx"; \
      wget -qO "/opt/piper/voices/${key}.onnx.json" "${base}.onnx.json"; \
      test -s "/opt/piper/voices/${key}.onnx"; \
      echo "baked Piper voice: ${key}"; \
    done

# Build-time smoke test: fail early if Piper can't synthesize.
RUN echo "freeswitch piper build check" \
      | /opt/piper/piper --model "/opt/piper/voices/${PIPER_VOICE}.onnx" \
          --espeak_data /opt/piper/espeak-ng-data --output_file /tmp/_piper_check.wav \
 && test -s /tmp/_piper_check.wav && rm -f /tmp/_piper_check.wav && echo "Piper OK"

COPY config/tts_commandline.conf.xml /usr/local/freeswitch/conf/autoload_configs/tts_commandline.conf.xml

# ── 8. Load mod_audio_stream + mod_tts_commandline, and default TTS to Piper ──
RUN MODCONF=/usr/local/freeswitch/conf/autoload_configs/modules.conf.xml \
 && grep -q 'mod_audio_stream' "$MODCONF" \
    || sed -i 's@</modules>@  <load module="mod_audio_stream"/>\n  </modules>@' "$MODCONF" \
 && grep -q 'mod_tts_commandline' "$MODCONF" \
    || sed -i 's@</modules>@  <load module="mod_tts_commandline"/>\n  </modules>@' "$MODCONF" \
 && grep -q 'mod_audio_stream' "$MODCONF" && grep -q 'mod_tts_commandline' "$MODCONF" \
 && VARS=/usr/local/freeswitch/conf/vars.xml \
 && grep -q 'tts_engine=tts_commandline' "$VARS" \
    || sed -i "s@</include>@  <X-PRE-PROCESS cmd=\"set\" data=\"tts_engine=tts_commandline\"/>\n  <X-PRE-PROCESS cmd=\"set\" data=\"tts_voice=${PIPER_VOICE}\"/>\n</include>@" "$VARS" \
 && grep -q "tts_voice=${PIPER_VOICE}" "$VARS"

# ── 9. Trim build artefacts (keeps the runtime libs, drops the source trees) ──
RUN rm -rf /usr/src/*

# SIP (UDP/TCP), Event Socket (ESL), and the default RTP media range.
EXPOSE 5060/udp 5060/tcp 5080/udp 5080/tcp 8021/tcp 16384-16404/udp

# Run FreeSWITCH in the foreground (no fork, no auto-NAT) so it owns PID 1.
CMD ["/usr/local/freeswitch/bin/freeswitch", "-nf", "-nonat", "-nc"]
