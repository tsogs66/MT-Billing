# =============================================================================
# MT-Billing — MikroTik OLT management access
# =============================================================================
# Purpose: Let hosts on management LAN 20.0.0.0/24 reach Wolock OLT 192.168.0.100
#          (SNMP/HTTP/SSH) for MT-Billing status probes.
#
# EDIT BEFORE IMPORT:
#   oltInterface = RouterOS port wired to OLT management (not your 20.0.0.x LAN)
#
# Upload via Winbox → Files, then:
#   /import file-name=mikrotik-olt-access.rsc
# =============================================================================

:local oltInterface "ether2"
:local oltRouterIp "192.168.0.1/24"
:local oltHost "192.168.0.100"
:local oltNet "192.168.0.0/24"
:local mgmtNet "20.0.0.0/24"
:local tag "mt-billing-olt"

:if ([:len [/ip address find where comment=$tag]] = 0) do={
  /ip address add address=$oltRouterIp interface=$oltInterface comment=$tag
  :log info ("MT-Billing: added " . $oltRouterIp . " on " . $oltInterface)
} else={
  :log info "MT-Billing: OLT interface address already exists (skipped)"
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

:if ([:len [/ip firewall filter find where comment=($tag . "-input")]] = 0) do={
  /ip firewall filter add chain=input action=accept dst-address=$oltHost comment=($tag . "-input") place-before=0
}

:log info ("MT-Billing OLT access done. Test: /ping " . $oltHost)
