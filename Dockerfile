FROM debian:bullseye-slim

# Install dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    wget \
    libssl-dev \
    libncurses5-dev \
    libnewt-dev \
    libxml2-dev \
    libsqlite3-dev \
    uuid-dev \
    libjansson-dev \
    libedit-dev \
    libsrtp2-dev \
    ca-certificates \
    xmlstarlet \
    && rm -rf /var/lib/apt/lists/*

# Download and build Asterisk
WORKDIR /usr/src
RUN wget http://downloads.asterisk.org/pub/telephony/asterisk/asterisk-20-current.tar.gz && \
    tar xvf asterisk-20-current.tar.gz && \
    cd asterisk-20.* && \
    ./configure --with-jansson-bundled --with-pjproject-bundled && \
    make menuselect.makeopts && \
    menuselect/menuselect \
        --enable chan_pjsip \
        --enable res_pjsip \
        --enable res_pjsip_session \
        --enable res_pjsip_transport_websocket \
        --enable res_http_websocket \
        --enable codec_opus \
        menuselect.makeopts && \
    make -j$(nproc) && \
    make install && \
    make samples && \
    make config && \
    ldconfig && \
    cd / && \
    rm -rf /usr/src/asterisk-*

# Create asterisk user
RUN useradd -m asterisk && \
    chown -R asterisk:asterisk /var/lib/asterisk && \
    chown -R asterisk:asterisk /var/spool/asterisk && \
    chown -R asterisk:asterisk /var/log/asterisk && \
    chown -R asterisk:asterisk /var/run/asterisk && \
    chown -R asterisk:asterisk /etc/asterisk

# Copy configuration files
COPY configs/ /etc/asterisk/

# Expose ports
# 5060 UDP - SIP
# 8088 TCP - HTTP
# 8089 TCP - HTTPS/WSS
# 10000-20000 UDP - RTP
EXPOSE 5060/udp 8088/tcp 8089/tcp 10000-20000/udp

USER asterisk

CMD ["/usr/sbin/asterisk", "-f", "-vvv"]