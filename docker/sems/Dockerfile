# SEMS (SIP Express Media Server) — OPTIONAL alternative media server.
#
# There is no official published SEMS image, so we build from source. This is a
# single-stage build-and-run image: simple and reliable for a parked/reference
# component (it is larger than a multi-stage image — acceptable here since it is
# not part of the live stack).
#
# Build:  docker build -t callnet-sems .
# Pin:    docker build --build-arg SEMS_REF=master -t callnet-sems .

FROM debian:bookworm-slim

# Release tag to build (see https://github.com/sems-server/sems/releases).
ARG SEMS_REF=2.1.0
ENV DEBIAN_FRONTEND=noninteractive

# Build toolchain + optional feature libraries (Opus, spandsp, TTS/flite,
# OpenSSL, resampler, Python, libev/libevent for jsonrpc/conference, hiredis
# for the Redis-based call-control modules).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates git cmake g++ make pkg-config \
        libspandsp-dev libspeex-dev libspeexdsp-dev libgsm1-dev libopus-dev \
        libssl-dev python3-dev libev-dev libevent-dev libxml2-dev \
        libcurl4-openssl-dev libhiredis-dev flite1-dev libsamplerate0-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src
RUN git clone --depth 1 --branch "${SEMS_REF}" https://github.com/sems-server/sems.git

WORKDIR /usr/src/sems/build
RUN cmake \
        -DCMAKE_BUILD_TYPE=Release \
        -DSEMS_USE_OPUS=ON \
        -DSEMS_USE_SPANDSP=ON \
        -DSEMS_USE_TTS=ON \
        -DSEMS_USE_OPENSSL=ON \
        -DSEMS_USE_LIBSAMPLERATE=ON \
        -DSEMS_USE_PYTHON=ON \
        .. \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

# Config is provided via a bind mount (see docker-compose.sems.yml) at
# /usr/local/etc/sems. The image ships the upstream sample configs too.

# SIP (5080) + RTP relay range (20000-20100) — see conf/sems.conf.
EXPOSE 5080/udp 5080/tcp 20000-20100/udp

# -E = run in foreground and log to stderr (so `docker logs` works).
CMD ["sems", "-f", "/usr/local/etc/sems/sems.conf", "-E"]
