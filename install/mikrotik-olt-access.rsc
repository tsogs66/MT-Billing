# =============================================================================
# MT-Billing — MikroTik route to OLT via TP-Link ER7206
# =============================================================================
# Topology:
#   [MT-Billing / LAN]  20.0.0.0/24  on MikroTik (20.0.0.1)
#         |
#   [MikroTik] 20.0.0.1  ----  20.0.0.5  [ER7206]  50.0.0.1 ---- [OLT 50.0.0.100]
#
# MikroTik routes 50.0.0.0/24 via ER7206 (20.0.0.5).
#
# Upload via Winbox → Files, then:
#   /import file-name=mikrotik-olt-access.rsc
# =============================================================================

:local er7206Gw "20.0.0.5"
:local oltHost "50.0.0.100"
:local oltNet "50.0.0.0/24"
:local mgmtNet "20.0.0.0/24"
:local tag "mt-billing-olt"

:if ([:len [/ip route find where comment=$tag]] = 0) do={
  /ip route add dst-address=$oltNet gateway=$er7206Gw comment=$tag
  :log info ("MT-Billing: route " . $oltNet . " via " . $er7206Gw)
} else={
  :log info "MT-Billing: OLT route already exists (skipped)"
}

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

:if ([:len [/ip firewall filter find where comment=($tag . "-gw")]] = 0) do={
  /ip firewall filter add chain=forward action=accept dst-address=$er7206Gw comment=($tag . "-gw") place-before=0
}

:log info ("MT-Billing: test from MikroTik: /ping " . $oltHost)

# =============================================================================
# TERMINAL PASTE (literal IPs) — copy/paste line by line:
#
# /ip route add dst-address=50.0.0.0/24 gateway=20.0.0.5 comment=mt-billing-olt
#
# /ip firewall filter add chain=forward action=accept protocol=udp src-address=20.0.0.0/24 dst-address=50.0.0.100 dst-port=161 comment=mt-billing-olt-snmp place-before=0
# /ip firewall filter add chain=forward action=accept protocol=tcp src-address=20.0.0.0/24 dst-address=50.0.0.100 dst-port=22,23,80,443,8080 comment=mt-billing-olt-tcp place-before=0
# /ip firewall filter add chain=forward action=accept src-address=20.0.0.0/24 dst-address=50.0.0.0/24 comment=mt-billing-olt-all place-before=0
# /ip firewall filter add chain=forward action=accept connection-state=established,related comment=mt-billing-olt-return place-before=0
# /ip firewall filter add chain=forward action=accept dst-address=20.0.0.5 comment=mt-billing-olt-gw place-before=0
#
# Remove old wrong route if added earlier:
# /ip route remove [find where comment=mt-billing-olt and dst-address=192.168.0.0/24]
#
# Test: /ping 20.0.0.5  then  /ping 50.0.0.100
#
# ER7206 OLT side: 50.0.0.1/24  |  OLT gateway: 50.0.0.1  |  MT-Billing OLT host: 50.0.0.100
# =============================================================================
