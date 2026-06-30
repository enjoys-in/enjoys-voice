# syntax=docker/dockerfile:1
#
# Build a FreeSWITCH .deb for the CallNet edge appliance, FROM SOURCE, with a
# trimmed module set (no signalwire / verto / v8 / spandsp — so it needs only
# the handful of system libs installed below). Multi-arch via buildx + qemu.
# The final `export` stage carries ONLY the resulting .deb.
#
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     --target export --output type=local,dest=out edge/packaging/freeswitch
#
# NOTE: a from-source FreeSWITCH build is ~20–40 min per arch (arm64 under qemu
# is slower) and occasionally needs a module/version tweak — validate in CI.
ARG FS_VERSION=v1.10.12
ARG SOFIA_VERSION=v1.13.17

FROM debian:bookworm-slim AS build
ARG FS_VERSION
ARG SOFIA_VERSION
ARG WITH_SOUNDS=true
ENV DEBIAN_FRONTEND=noninteractive
ENV PKG_CONFIG_PATH=/usr/lib/pkgconfig

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential automake autoconf libtool libtool-bin pkg-config cmake \
      git ca-certificates wget yasm \
      libssl-dev libcurl4-openssl-dev libpcre3-dev libedit-dev libsqlite3-dev \
      libldns-dev libopus-dev libsndfile1-dev libspeex-dev libspeexdsp-dev \
      uuid-dev zlib1g-dev libtiff-dev \
      ruby ruby-dev \
 && gem install --no-document fpm \
 && rm -rf /var/lib/apt/lists/*

# sofia-sip — the external SIP stack mod_sofia links against. Installed real (so
# the FS build finds it) AND staged (so its .so ships inside the .deb).
RUN git clone --depth 1 -b ${SOFIA_VERSION} https://github.com/freeswitch/sofia-sip.git /usr/src/sofia-sip \
 && cd /usr/src/sofia-sip \
 && ./bootstrap.sh \
 && ./configure --prefix=/usr --disable-static \
 && make -j"$(nproc)" \
 && make install \
 && make install DESTDIR=/staging \
 && ldconfig

# FreeSWITCH
RUN git clone --depth 1 -b ${FS_VERSION} https://github.com/signalwire/freeswitch.git /usr/src/freeswitch
COPY modules.conf /usr/src/freeswitch/modules.conf
WORKDIR /usr/src/freeswitch
RUN ./bootstrap.sh -j \
 && ./configure --prefix=/usr --sysconfdir=/etc --localstatedir=/var --disable-static \
 && make -j"$(nproc)" \
 && make install DESTDIR=/staging

# Sounds (8 kHz) + music-on-hold — installed real then copied into the stage
# (the sounds-install target is not reliably DESTDIR-aware).
RUN if [ "${WITH_SOUNDS}" = "true" ]; then \
      make sounds-install moh-install \
   && mkdir -p /staging/usr/share/freeswitch \
   && cp -a /usr/share/freeswitch/sounds /staging/usr/share/freeswitch/ ; \
    fi

# Package the staged tree into a .deb with fpm.
RUN printf '#!/bin/sh\nset -e\nldconfig\n' > /tmp/after-install.sh && chmod +x /tmp/after-install.sh
RUN VER="$(echo "${FS_VERSION}" | sed 's/^v//')" && ARCH="$(dpkg --print-architecture)" \
 && mkdir -p /out \
 && fpm -s dir -t deb -n callnet-freeswitch -v "${VER}" \
      --description "FreeSWITCH for the CallNet edge appliance (trimmed module set)" \
      --maintainer "CallNet" --vendor "CallNet" --license "MPL-1.1" \
      --after-install /tmp/after-install.sh \
      --depends libssl3 --depends libcurl4 --depends libpcre3 --depends libedit2 \
      --depends libsqlite3-0 --depends libldns3 --depends libopus0 --depends libsndfile1 \
      --depends libspeex1 --depends libspeexdsp1 --depends zlib1g \
      --deb-no-default-config-files \
      -C /staging \
      --package "/out/callnet-freeswitch_${VER}_${ARCH}.deb" \
      usr etc var

# Export stage: only the .deb (buildx writes it to --output dest, per platform).
FROM scratch AS export
COPY --from=build /out/ /
