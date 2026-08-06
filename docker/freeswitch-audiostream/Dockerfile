# ─────────────────────────────────────────────────────────────────────────────
# MULTI-STAGE BUILD: FreeSWITCH (from source) + mod_audio_stream + Piper TTS.
#
# Stage 1 ("builder"): compiles everything — source trees, compilers, -dev
#   headers all stay in the throwaway builder layer.
# Stage 2 ("runtime"): slim Debian with ONLY runtime libs + installed binaries.
#
# Expected final image: ~300–400 MB (vs ~1+ GB single-stage).
# ─────────────────────────────────────────────────────────────────────────────

# ═══════════════════════════════════════════════════════════════════════════════
#  STAGE 1 — BUILDER
# ═══════════════════════════════════════════════════════════════════════════════
FROM debian:bookworm-slim AS builder

ARG FS_VERSION=v1.10.12
ARG MOD_AUDIO_STREAM_REF=master
ARG PIPER_VERSION=2023.11.14-2
ARG PIPER_ARCH=x86_64
ARG PIPER_VOICE=en_US-amy-medium
ARG PIPER_VOICE_PATH=en/en_US/amy/medium
ARG PIPER_EXTRA_VOICES="hi_IN-rohan-medium hi_IN-priyamvada-medium"
ENV DEBIAN_FRONTEND=noninteractive

# ── Build toolchain + all -dev dependencies ──
RUN apt-get update && apt-get install -y --no-install-recommends \
     autoconf automake bison build-essential ca-certificates cmake flex git \
     libtool libtool-bin pkg-config wget lsb-release yasm \
     libssl-dev zlib1g-dev libdb-dev unixodbc-dev libncurses5-dev libexpat1-dev \
     libgdbm-dev libtiff-dev uuid-dev libpcre3-dev libedit-dev libsqlite3-dev \
     libcurl4-openssl-dev libopus-dev libsndfile1-dev libspeex-dev libspeexdsp-dev \
     libldns-dev libpng-dev libjpeg-dev libevent-dev liblua5.2-dev \
     && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src

RUN git config --global --add safe.directory '*'

# ── 1. libks ──
RUN git clone --depth 1 https://github.com/signalwire/libks.git \
     && cd libks \
     && sed -i 's/if(GIT_FOUND AND GZIP_CMD AND DATE_CMD)/if(FALSE)/g' CMakeLists.txt \
     && cmake -S . -B build -DCMAKE_INSTALL_PREFIX=/usr -DCMAKE_BUILD_TYPE=Release \
     && cmake --build build --target install -j"$(nproc)" \
     && ldconfig

# ── 2. signalwire-c ──
RUN git clone --depth 1 https://github.com/signalwire/signalwire-c.git \
     && cd signalwire-c \
     && sed -i 's/if(GIT_FOUND AND GZIP_CMD AND DATE_CMD)/if(FALSE)/g' CMakeLists.txt || true \
     && cmake -S . -B build -DCMAKE_INSTALL_PREFIX=/usr -DCMAKE_BUILD_TYPE=Release \
     && touch build/copyright \
     && cmake --build build --target install -j"$(nproc)" \
     && ldconfig

# ── 3. sofia-sip ──
RUN git clone --depth 1 https://github.com/freeswitch/sofia-sip.git \
     && cd sofia-sip && ./bootstrap.sh && ./configure --prefix=/usr \
     && make -j"$(nproc)" && make install && ldconfig

# ── 4. spandsp (Hard dependency for FS 1.10 core) ──
RUN git clone --depth 1 https://github.com/freeswitch/spandsp.git \
     && cd spandsp && ./bootstrap.sh && ./configure --prefix=/usr \
     && make -j"$(nproc)" && make install && ldconfig


# ── 5. FreeSWITCH ──
RUN echo "cache-bust: rebuild freeswitch with spandsp" \
 && git clone --depth 1 -b "${FS_VERSION}" https://github.com/signalwire/freeswitch.git \
 && cd freeswitch \
 && ./bootstrap.sh -j \
     && sed -i -E 's@^(applications/mod_av)@#\1@; s@^(applications/mod_cv)@#\1@; s@^(formats/mod_shout)@#\1@; s@^(formats/mod_av)@#\1@; s@^(asr_tts/mod_flite)@#\1@; s@^(databases/mod_pgsql)@#\1@; s@^(applications/mod_spandsp)@#\1@; s@^#?(asr_tts/mod_tts_commandline)@\1@' modules.conf \
     && ./configure --prefix=/usr/local/freeswitch --disable-dependency-tracking \
     && make -j"$(nproc)" \
     && make install \
     && ldconfig

# ── 6. mod_audio_stream ──
RUN export PKG_CONFIG_PATH=/usr/local/freeswitch/lib/pkgconfig \
     && git clone https://github.com/amigniter/mod_audio_stream.git \
     && cd mod_audio_stream \
     && if [ "${MOD_AUDIO_STREAM_REF}" != "master" ] && [ "${MOD_AUDIO_STREAM_REF}" != "main" ]; then git checkout "${MOD_AUDIO_STREAM_REF}"; fi \
     && git submodule update --init --recursive \
     && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
     && cmake --build build -j"$(nproc)" \
     && cmake --install build \
     && find /usr/local/freeswitch -name mod_audio_stream.so | grep -q .

# ── 7. Piper TTS ──
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

# Smoke test Piper in the builder.
RUN echo "freeswitch piper build check" \
     | /opt/piper/piper --model "/opt/piper/voices/${PIPER_VOICE}.onnx" \
     --espeak_data /opt/piper/espeak-ng-data --output_file /tmp/_piper_check.wav \
     && test -s /tmp/_piper_check.wav && rm -f /tmp/_piper_check.wav && echo "Piper OK"

# ── 8. Wire up configs (while we still have sed/grep) ──
COPY config/tts_commandline.conf.xml /usr/local/freeswitch/etc/freeswitch/autoload_configs/tts_commandline.conf.xml

RUN MODCONF=/usr/local/freeswitch/etc/freeswitch/autoload_configs/modules.conf.xml \
 && sed -i -E 's@<load module="mod_spandsp"/>@<!-- <load module="mod_spandsp"/> -->@g' "$MODCONF" \
 && sed -i -E 's@<!--\s*<load module="mod_tts_commandline"/>\s*-->|<load module="mod_tts_commandline"/>@<load module="mod_tts_commandline"/>@g' "$MODCONF" \
 && grep -q 'mod_audio_stream' "$MODCONF" \
    || sed -i 's@</modules>@  <load module="mod_audio_stream"/>\n  </modules>@' "$MODCONF" \
     && grep -q 'mod_audio_stream' "$MODCONF" && grep -q 'mod_tts_commandline' "$MODCONF" \
     && VARS=/usr/local/freeswitch/etc/freeswitch/vars.xml \
     && grep -q 'tts_engine=tts_commandline' "$VARS" \
     || sed -i "s@</include>@  <X-PRE-PROCESS cmd=\"set\" data=\"tts_engine=tts_commandline\"/>\n  <X-PRE-PROCESS cmd=\"set\" data=\"tts_voice=${PIPER_VOICE}\"/>\n</include>@" "$VARS" \
     && grep -q "tts_voice=${PIPER_VOICE}" "$VARS" \
     && sed -i 's/value="::"/value="0.0.0.0"/' /usr/local/freeswitch/etc/freeswitch/autoload_configs/event_socket.conf.xml

RUN mkdir -p /usr/local/freeswitch/tmp && chmod 1777 /usr/local/freeswitch/tmp

# ── Collect all shared libs that our binaries actually need ──
# We copy /usr/lib and /usr/local/freeswitch/lib — the runtime stage will
# have the base Debian libs; we just need the ones we built from source.
RUN mkdir -p /build-out/usr-libs \
     && echo "cache-bust: cp libspandsp" \
     && cp -a /usr/lib/libks2* /build-out/usr-libs/ 2>/dev/null || true \
     && cp -a /usr/lib/libsignalwire* /build-out/usr-libs/ 2>/dev/null || true \
     && cp -a /usr/lib/libsofia* /build-out/usr-libs/ 2>/dev/null || true \
     && cp -a /usr/lib/x86_64-linux-gnu/libspandsp* /build-out/usr-libs/ 2>/dev/null || true \
     && cp -a /usr/lib/libsu* /build-out/usr-libs/ 2>/dev/null || true


# ═══════════════════════════════════════════════════════════════════════════════
#  STAGE 2 — RUNTIME (slim)
# ═══════════════════════════════════════════════════════════════════════════════
FROM debian:bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive

# Only RUNTIME libraries — no compilers, no -dev headers, no git.
RUN apt-get update && apt-get install -y --no-install-recommends \
     ca-certificates \
     libssl3 zlib1g libdb5.3 unixodbc libncurses6 libexpat1 \
     libgdbm6 libtiff6 libuuid1 libpcre3 libedit2 libsqlite3-0 \
     libcurl4 libopus0 libsndfile1 libspeex1 libspeexdsp1 \
     libldns3 libpng16-16 libjpeg62-turbo libevent-2.1-7 libevent-pthreads-2.1-7 liblua5.2-0 \
     && rm -rf /var/lib/apt/lists/*

# ── Copy built artifacts from builder ──
COPY --from=builder /usr/local/freeswitch /usr/local/freeswitch
COPY --from=builder /opt/piper            /opt/piper
COPY --from=builder /build-out/usr-libs/  /usr/lib/

# Refresh the linker cache so our custom .so files are found.
RUN echo "/usr/local/freeswitch/lib" > /etc/ld.so.conf.d/freeswitch.conf \
 && ldconfig

ENV PATH="/usr/local/freeswitch/bin:${PATH}"

RUN mkdir -p /usr/local/freeswitch/tmp && chmod 1777 /usr/local/freeswitch/tmp /tmp

# SIP (UDP/TCP), Event Socket (ESL), and the default RTP media range.
EXPOSE 5060/udp 5060/tcp 5080/udp 5080/tcp 8021/tcp 16384-16404/udp

# Run FreeSWITCH in the foreground with console enabled so logs go to Docker stdout.
CMD ["/usr/local/freeswitch/bin/freeswitch", "-nonat", "-c"]
