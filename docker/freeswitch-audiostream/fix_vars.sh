#!/bin/bash
sed -i 's/.*<X-PRE-PROCESS cmd="set" data="external_rtp_ip=$${local_ip_v4}"\/>/<X-PRE-PROCESS cmd="set" data="external_rtp_ip=127.0.0.1"\/>/g' /usr/local/freeswitch/etc/freeswitch/vars.xml
sed -i 's/.*<X-PRE-PROCESS cmd="set" data="external_sip_ip=$${local_ip_v4}"\/>/<X-PRE-PROCESS cmd="set" data="external_sip_ip=127.0.0.1"\/>/g' /usr/local/freeswitch/etc/freeswitch/vars.xml
kill $(cat /usr/local/freeswitch/run/freeswitch.pid)
