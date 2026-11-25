# DNS providers

What NPMpro does with each DNS provider. Every provider below has a certbot plugin for the DNS challenge (a
certificate, wildcards included); the other columns are what NPMpro adds on top.

| Feature | Providers | What it means |
|---|---|---|
| DNS challenge | 86 of 90 (4 deprecated plugins no longer install) | certbot proves the domain through the provider's DNS with a saved [DNS credential](DNS#dns-challenge) |
| Credential form | 19 | the credential has labelled fields (secrets hidden); the others take the plugin's INI text as its documentation shows it |
| Fetch domains | 13 | the Add domains window lists the provider's zones to tick ([Domains from the provider](DNS#domains-from-the-provider)); for the others type the domains |
| Test | 13 | the **Test** button of a saved credential reads one page of the zone list and, where the provider can read records, one record, and says whether the key works ([Test a credential](DNS#test-a-credential)) |
| Cleanup | 7 | **Clean up challenge records** lists and deletes leftover `_acme-challenge` TXT records ([Leftover challenge records](DNS#leftover-challenge-records)) |
| Dynamic DNS | 8, and 3 presets | NPMpro keeps an address record (A/AAAA) at the public IP, or an alias (CNAME) pointing at a name ([Dynamic DNS](DNS#dynamic-dns)); wildcard records (`*.example.com`) only on Cloudflare and DigitalOcean. Namecheap, No-IP and Dynu are presets with their own account details (no DNS credential), and Custom HTTP (administrators only) calls a URL you set; these keep an address record only |

**Deprecated** plugins (7) are kept for credentials that already use them: their projects are no longer maintained or
the provider closed the API, so they may no longer work. Four of them (Constellix, Core Networks, DNSPod, Oracle Cloud
Infrastructure DNS) no longer install with this NPMpro version because their dependencies conflict with certbot's; a
certificate request with them fails. Move such a domain to another provider or plugin.

The plugin versions are the ones this NPMpro version installs.

| Provider | Key | Certbot plugin | DNS challenge | Credential form | Fetch domains | Test | Cleanup | Dynamic DNS |
|---|---|---|---|---|---|---|---|---|
| ACME-DNS | `acmedns` | `certbot-dns-acmedns` 0.1.0 | Yes | INI text |  |  |  |  |
| Active24 | `active24` | `certbot-dns-active24` 2.0.2 | Yes | INI text |  |  |  |  |
| Akamai Edge DNS | `edgedns` | `certbot-plugin-edgedns` 0.3.0 | Yes | INI text |  |  |  |  |
| Aliyun | `aliyun` | `certbot-dns-aliyun` 2.0.0 | Yes | INI text |  |  |  |  |
| All-Inkl | `kas` | `certbot-dns-kas` 1.0.0 | Yes | INI text |  |  |  |  |
| ArvanCloud | `arvan` | `certbot-dns-arvan` 1.0.5 | Yes | INI text |  |  |  |  |
| Azure | `azure` | `certbot-dns-azure-modern` 2.8.1 | Yes | INI text |  |  |  |  |
| Baidu | `baidu` | `certbot-dns-baidu-bcd` 2.0.0 | Yes | INI text |  |  |  |  |
| Beget | `beget-dns` | `certbot-dns-beget-plugin` 1.0.0 | Yes | INI text |  |  |  |  |
| Beget (old plugin) | `beget` | `certbot-beget-plugin` 1.0.0.dev10 | Yes, deprecated | INI text |  |  |  |  |
| bunny.net | `bunny` | `certbot-dns-bunny` 3.0.0 | Yes | Fields | Yes | Yes |  |  |
| cdmon | `cdmon` | `certbot-dns-cdmon` 0.4.1 | Yes | INI text |  |  |  |  |
| Cloudflare | `cloudflare` | `certbot-dns-cloudflare` 5.10.0 | Yes | Fields | Yes | Yes | Yes | Yes |
| ClouDNS | `cloudns` | `certbot-dns-cloudns` 0.7.0 | Yes | INI text |  |  |  |  |
| CloudXNS | `cloudxns` | `certbot-dns-cloudxns` 1.32.0 | Yes, deprecated | INI text |  |  |  |  |
| Constellix | `constellix` | `certbot-dns-constellix` 0.3.1 | No: deprecated, the plugin no longer installs | INI text |  |  |  |  |
| Core Networks | `corenetworks` | `certbot-dns-corenetworks` 0.2.1 | No: deprecated, the plugin no longer installs | INI text |  |  |  |  |
| cPanel | `cpanel` | `certbot-dns-cpanel` 0.4.0 | Yes | INI text |  |  |  |  |
| DDNSS | `ddnss` | `certbot-dns-ddnss` 1.1.0 | Yes | INI text |  |  |  |  |
| deSEC | `desec` | `certbot-dns-desec` 1.3.2 | Yes | Fields | Yes | Yes | Yes | Yes |
| DigitalOcean | `digitalocean` | `certbot-dns-digitalocean` 5.10.0 | Yes | Fields | Yes | Yes | Yes | Yes |
| DirectAdmin | `directadmin` | `certbot-dns-directadmin` 1.0.15 | Yes | INI text |  |  |  |  |
| DNS Made Easy | `dnsmadeeasy` | `certbot-dns-dnsmadeeasy` 5.10.0 | Yes | INI text |  |  |  |  |
| DNSimple | `dnsimple` | `certbot-dns-dnsimple` 5.10.0 | Yes | INI text |  |  |  |  |
| DNSPod | `dnspod` | `certbot-dnspod` 0.1.4 | No: deprecated, the plugin no longer installs | INI text |  |  |  |  |
| DomainOffensive (do.de) | `domainoffensive` | `certbot-dns-domainoffensive` 2.0.0 | Yes | INI text |  |  |  |  |
| Domeneshop | `domeneshop` | `certbot-dns-domeneshop` 0.2.9 | Yes | INI text |  |  |  |  |
| Dreamhost | `dreamhost` | `certbot-dns-dreamhost` 1.0 | Yes | INI text |  |  |  |  |
| DuckDNS | `duckdns` | `certbot-dns-duckdns` 1.9.0 | Yes | Fields |  |  |  | Yes |
| Dynu | `dynu` | `certbot-dns-dynu` 0.0.6.post2502111739272536 | Yes | INI text |  |  |  | Preset |
| easyDNS | `easydns` | `certbot-dns-easydns` 0.1.4 | Yes | INI text |  |  |  |  |
| EuroDNS | `eurodns` | `certbot-dns-eurodns` 1.8.2 | Yes | INI text |  |  |  |  |
| First Domains | `firstdomains` | `certbot-dns-firstdomains` 1.0.4 | Yes | INI text |  |  |  |  |
| FreeDNS | `freedns` | `certbot-dns-freedns` 0.2.0 | Yes | INI text |  |  |  |  |
| Gandi Live DNS | `gandi` | `certbot-dns-gandi` 1.6.2 | Yes | Fields | Yes | Yes | Yes | Yes |
| Gcore DNS | `gcore` | `certbot-dns-gcore` 0.1.8 | Yes | INI text |  |  |  |  |
| Glesys | `glesys` | `certbot-dns-glesys` 2.1.0 | Yes | INI text |  |  |  |  |
| GoDaddy | `godaddy` | `certbot-dns-godaddy` 2.8.0 | Yes | Fields | Yes | Yes |  |  |
| Google | `google` | `certbot-dns-google` 5.10.0 | Yes | INI text |  |  |  |  |
| GoogleDomainsDNS | `googledomains` | `certbot-dns-google-domains` 0.1.11 | Yes, deprecated | INI text |  |  |  |  |
| Hetzner | `hetzner` | `certbot-dns-hetzner` 4.0.0 | Yes | Fields |  |  |  |  |
| Hetzner Cloud | `hetzner-cloud` | `certbot-dns-hetzner-cloud` 1.1.0 | Yes | Fields | Yes | Yes | Yes | Yes |
| hoster.by | `hosterby` | `certbot-dns-hosterby` 0.1.0 | Yes | INI text |  |  |  |  |
| Hosting.nl | `hostingnl` | `certbot-dns-hostingnl` 0.1.5 | Yes | INI text |  |  |  |  |
| Hostinger.com | `hostinger` | `certbot-dns-hostinger` 0.1.3 | Yes | INI text |  |  |  |  |
| Hover | `hover` | `certbot-dns-hover` 1.2.4 | Yes | INI text |  |  |  |  |
| Hurricane Electric | `he` | `certbot-dns-hurricane-electric` 0.1.0 | Yes | INI text |  |  |  |  |
| Hurricane Electric - DDNS | `he-ddns` | `certbot-dns-he-ddns` 0.1.0 | Yes | INI text |  |  |  |  |
| Infomaniak | `infomaniak` | `certbot-dns-infomaniak` 0.3.3 | Yes | INI text |  |  |  |  |
| INWX | `inwx` | `certbot-dns-inwx` 3.0.3 | Yes | Fields |  |  |  |  |
| IONOS | `ionos` | `certbot-dns-ionos` 2024.11.9 | Yes | Fields | Yes | Yes |  |  |
| ip-projects | `ipp` | `certbot-dns-ipp` 5.9.0 | Yes | INI text |  |  |  |  |
| ISPConfig | `ispconfig` | `certbot-v4-dns-ispconfig` 0.4.2 | Yes | INI text |  |  |  |  |
| Isset | `isset` | `certbot-dns-isset` 0.0.3 | Yes | INI text |  |  |  |  |
| Joker | `joker` | `certbot-dns-joker` 1.1.0 | Yes | INI text |  |  |  |  |
| LeaseWeb | `leaseweb` | `certbot-dns-leaseweb` 1.0.3 | Yes | INI text |  |  |  |  |
| Linode | `linode` | `certbot-dns-linode` 5.10.0 | Yes | Fields | Yes | Yes |  |  |
| Loopia | `loopia` | `certbot-dns-loopia` 1.0.1 | Yes | INI text |  |  |  |  |
| LuaDNS | `luadns` | `certbot-dns-luadns` 5.10.0 | Yes | INI text |  |  |  |  |
| LWS | `lws` | `certbot-dns-lws` 1.0.0 | Yes | INI text |  |  |  |  |
| MC-HOST24 | `mchost24` | `certbot-dns-mchost24` 1.0.0 | Yes | INI text |  |  |  |  |
| mijn.host | `mijnhost` | `certbot-dns-mijn-host` 0.0.10 | Yes | INI text |  |  |  |  |
| Name.com | `namecom` | `certbot-dns-namecom` 1.0.0 | Yes | INI text |  |  |  |  |
| Namecheap | `namecheap` | `certbot-dns-namecheap` 1.0.0 | Yes | Fields |  |  |  | Preset |
| netcup | `netcup` | `certbot-dns-netcup` 2.1.0 | Yes | Fields |  |  |  |  |
| nic.ru | `nicru` | `certbot-dns-nicru` 1.0.3 | Yes | INI text |  |  |  |  |
| Njalla | `njalla` | `certbot-dns-njalla` 2.0.2 | Yes | INI text |  |  |  |  |
| NS1 | `nsone` | `certbot-dns-nsone` 5.10.0 | Yes | INI text |  |  |  |  |
| Oracle Cloud Infrastructure DNS | `oci` | `certbot-dns-oci` 0.3.6 | No: deprecated, the plugin no longer installs | INI text |  |  |  |  |
| OVH | `ovh` | `certbot-dns-ovh` 5.10.0 | Yes | Fields | Yes | Yes | Yes | Yes |
| Plesk | `plesk` | `certbot-dns-plesk` 0.4.1 | Yes | INI text |  |  |  |  |
| Porkbun | `porkbun` | `certbot-dns-porkbun` 0.11.0 | Yes | Fields | Yes | Yes | Yes | Yes |
| PowerDNS | `powerdns` | `certbot-dns-pdns` 0.1.1 | Yes | Fields | Yes | Yes |  |  |
| RcodeZero | `rcode0` | `certbot-dns-rcode0` 0.0.0.2 | Yes | INI text |  |  |  |  |
| reg.ru | `regru` | `certbot-regru` 1.0.2 | Yes | INI text |  |  |  |  |
| RFC 2136 | `rfc2136` | `certbot-dns-rfc2136` 5.10.0 | Yes | Fields |  |  |  |  |
| rockenstein AG | `rockenstein` | `certbot-dns-rockenstein` 1.0.0 | Yes | INI text |  |  |  |  |
| Scaleway | `scaleway` | `certbot-dns-scaleway` 0.0.7 | Yes | INI text |  |  |  |  |
| Selectel api v2 | `selectelv2` | `certbot-dns-selectel-api-v2` 0.3.0 | Yes | INI text |  |  |  |  |
| Simply | `simply` | `certbot-dns-simply` 0.1.4 | Yes | INI text |  |  |  |  |
| Spaceship | `spaceship` | `certbot-dns-spaceship` 1.0.4 | Yes | INI text |  |  |  |  |
| Strato | `strato` | `certbot-dns-strato` 0.2.4 | Yes | INI text |  |  |  |  |
| Tencent Cloud | `tencentcloud` | `certbot-dns-tencentcloud` 2.1.1 | Yes | INI text |  |  |  |  |
| Tencent Cloud EdgeOne | `edgeone` | `certbot-dns-edgeone` 0.1.0 | Yes | INI text |  |  |  |  |
| Timeweb Cloud | `timeweb` | `certbot-dns-timeweb` 2.0.0 | Yes | INI text |  |  |  |  |
| TransIP | `transip` | `certbot-dns-transip` 0.5.2 | Yes | INI text |  |  |  |  |
| Vultr | `vultr` | `certbot-dns-vultr` 1.1.0 | Yes | Fields | Yes | Yes |  |  |
| Websupport.sk | `websupport` | `certbot-dns-websupport` 5.0.0 | Yes | INI text |  |  |  |  |
| Wedos | `wedos` | `certbot-dns-wedos` 2.5 | Yes | INI text |  |  |  |  |
| ZoneEdit | `zoneedit` | `certbot-dns-zoneedit` 0.3.2 | Yes | INI text |  |  |  |  |
