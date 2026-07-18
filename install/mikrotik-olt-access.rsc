# =============================================================================
# MT-Billing — MikroTik route to OLT via TP-Link ER7206
# =============================================================================
# Topology:
#   [MT-Billing / LAN]  20.0.0.0/24  on MikroTik (20.0.0.1)
#         |
#   [MikroTik] 20.0.0.1  ----  20.0.0.5  [ER7206]  192.168.0.1 ---- [OLT 192.168.0.100]
#
# MikroTik does NOT connect to the OLT directly. It routes 192.168.0.0/24 via ER7206.
#
# ALSO configure ER7206 — see comments at bottom of this file.
#
# Upload via Winbox → Files, then:
#   /import file-name=mikrotik-olt-access.rsc
# =============================================================================

:local er7206Gw "20.0.0.5"
:local oltHost "192.168.0.100"
:local oltNet "192.168.0.0/24"
:local mgmtNet "20.0.0.0/24"
:local tag "mt-billing-olt"

# --- 1) Static route to OLT subnet via ER7206 --------------------------------
:if ([:len [/ip route find where comment=$tag]] = 0) do={
  /ip route add dst-address=$oltNet gateway=$er7206Gw comment=$tag
  :log info ("MT-Billing: route " . $oltNet . " via " . $er7206Gw)
} else={
  :log info "MT-Billing: OLT route already exists (skipped)"
}

# --- 2) Firewall — allow management LAN → OLT (through ER7206) ---------------
:if ([:len [/ip firewall filter find where comment=($tag . "-snmp")]] = 0) do={
  /ip firewall filter add chain=forward action=accept protocol=udp src-address=$mgmtNet dst-address=$oltHost dst-port=161 comment=($tag . "-snmp") place-before=0
}

:if ([:len [/ip firewall filter find where comment=($tag . "-tcp")]] = 0) do={
  /ip firewall filter add chain=forward action=accept protocol=tcp src-address=$mgmtNet dst-address=$oltHost dst-port=22,23,80,443,8080 comment=($tag . "-tcp") place-before=0
}

:if ([:len [/ip firewall filter find where comment=($tag . "-all")]] = 0) do={
  /ip firewall filter add chain=forward action=accept src-address=$mgmtNet dst-address=$oltNet comment=($tag . "-all") place-before=0
}

:if ([:len [/ip firewall filter find where comment=($tag . "-return")]] = 0) do={
  /ip firewall filter add chain=forward action=accept connection-state=established,related comment=($tag . "-return") place-before=0
}

# Allow traffic to ER7206 gateway (ARP + forwarding)
:if ([:len [/ip firewall filter find where comment=($tag . "-gw")]] = 0) do={
  /ip firewall filter add chain=forward action=accept dst-address=$er7206Gw comment=($tag . "-gw") place-before=0
}

:log info ("MT-Billing: test from MikroTik: /ping " . $oltHost)

# =============================================================================
# ER7206 (20.0.0.5 / 192.168.0.1) — configure in Omada / web UI:
#
# 1) Interfaces
#    - Port to MikroTik: IP 20.0.0.5/24, gateway 20.0.0.1 (optional)
#    - Port to OLT:      IP 192.168.0.1/24
#
# 2) Firewall / Access Control — ALLOW (required on most ER7206 setups):
#    Source IP:      20.0.0.0/24
#    Destination IP: 192.168.0.100
#    Services:       SNMP (UDP 161), HTTP (80), HTTPS (443), SSH (22), Telnet (23)
#    Action:         Allow
#
# 3) Disable "Block WAN to LAN" / client isolation on the MikroTik-facing port
#    if probes still fail after MikroTik route is added.
#
# 4) On OLT: default gateway = 192.168.0.1, SNMP enabled, community = public
#
# Test order:
#    MikroTik:  /ping 20.0.0.5  then  /ping 192.168.0.100
#    Server:    ping 192.168.0.100  (gateway must be 20.0.0.1)
# =============================================================================
