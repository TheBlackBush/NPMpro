#!/usr/bin/env sh
# Tests check-unraid-template.py on a copy of the files it reads, each case with one change. Run from the
# repository root (it copies from there).
script=.github/scripts/check-unraid-template.py
ICONS="images/brand/npmpro-app-icon-256.png images/brand/npmpro-app-icon-1024.png"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
failed=0

fresh() {
    rm -rf "$dir/r"
    mkdir -p "$dir/r/rootfs/usr/local/bin" "$dir/r/images/brand"
    cp unraid-npmpro.xml ca_profile.xml compose.yaml "$dir/r/"
    cp rootfs/usr/local/bin/envs.sh "$dir/r/rootfs/usr/local/bin/"
    for icon in $ICONS; do cp "$icon" "$dir/r/$icon"; done
}

# $1: what the case is, $2: file in the copy, $3: sed expression, $4: text the output must contain
refuse() {
    fresh
    sed -i "$3" "$dir/r/$2"
    if cmp -s "$2" "$dir/r/$2"; then
        echo "FAIL: $1: the sed expression changed nothing"
        failed=1
        return
    fi
    if out="$(python3 -I "$script" "$dir/r")"; then
        echo "FAIL: $1: accepted"
        failed=1
    elif ! printf '%s\n' "$out" | grep -F -q -- "$4"; then
        echo "FAIL: $1: refused without \"$4\":"
        printf '%s\n' "$out"
        failed=1
    fi
}

fresh
out="$(python3 -I "$script" "$dir/r")" || { echo "FAIL: the files of the repository are refused:"; printf '%s\n' "$out"; failed=1; }

refuse "template does not parse" unraid-npmpro.xml 's|</Container>|</Contai>|' "unraid-npmpro.xml does not parse"
refuse "profile does not parse" ca_profile.xml 's|<Profile>|<Profile><b>|' "ca_profile.xml does not parse"
refuse "empty profile" ca_profile.xml 's|<Profile>.*</Profile>|<Profile></Profile>|' "has an empty Profile"
refuse "TemplateURL on develop" unraid-npmpro.xml 's|NPMpro/main/unraid|NPMpro/develop/unraid|' "TemplateURL is not"
refuse "Icon on develop" unraid-npmpro.xml 's|NPMpro/main/images|NPMpro/develop/images|' "Icon is 'https://raw.githubusercontent.com/TheBlackBush/NPMpro/develop/"
refuse "Icon of a missing file" ca_profile.xml 's|app-icon-256|app-icon-512|' "which is not in the repository"
refuse "Icon not 256 px" unraid-npmpro.xml 's|<Icon>.*</Icon>|<Icon>https://raw.githubusercontent.com/TheBlackBush/NPMpro/main/images/brand/npmpro-app-icon-1024.png</Icon>|' "not 256 x 256"
refuse "unknown variable" unraid-npmpro.xml 's|Target="PGID"|Target="PGUID"|' "PGUID, which NPMpro does not read"
refuse "_FILE of a name that is not a secret" unraid-npmpro.xml 's|Target="COOKIE_SECRET_FILE"|Target="TZ_FILE"|' "TZ cannot be read from a file"
refuse "a TZ field" unraid-npmpro.xml 's|Target="PGID"|Target="TZ"|' "sets TZ: Unraid passes"
refuse "_FILE with a default" unraid-npmpro.xml '/Target="COOKIE_SECRET_FILE"/s|Default=""|Default="/run/secrets/cookie"|' "COOKIE_SECRET_FILE has a default"
refuse "secret with a default" unraid-npmpro.xml '/Target="INITIAL_ADMIN_PASSWORD"/s|Default=""|Default="changeme1234"|' "INITIAL_ADMIN_PASSWORD has a default"
refuse "a port variable" unraid-npmpro.xml 's|Target="PUID"|Target="HTTP_PORT"|' "sets HTTP_PORT"
refuse "secret not masked" unraid-npmpro.xml '/Target="INITIAL_ADMIN_PASSWORD"/s|Mask="true"|Mask="false"|' "INITIAL_ADMIN_PASSWORD is not masked"
refuse "value differs from Default" unraid-npmpro.xml 's|Mask="false">99<|Mask="false">98<|' "PUID has a value other than its Default"
refuse "missing attribute" unraid-npmpro.xml '/Target="PGID"/s| Mask="false"||' "Config PGID has no Mask"
refuse "container port moved" unraid-npmpro.xml 's|Target="80" Default="8080"|Target="8080" Default="8080"|' "the container ports are"
refuse "no udp port" unraid-npmpro.xml '/Mode="udp"/d' "the container ports are"
refuse "host port twice" unraid-npmpro.xml 's|Default="8080" Mode="tcp"\(.*\)>8080<|Default="8443" Mode="tcp"\1>8443<|' "host port 8443/tcp is mapped twice"
refuse "secrets folder writable" unraid-npmpro.xml '/Target="\/run\/secrets"/s|Mode="ro"|Mode="rw"|' "/run/secrets is not read-only"
refuse "WebUI over http" unraid-npmpro.xml 's|<WebUI>https:|<WebUI>http:|' "WebUI is not"
refuse "envs.sh port default changed" rootfs/usr/local/bin/envs.sh 's|HTTP_PORT:-80}|HTTP_PORT:-8080}|' "HTTP_PORT: default 8080 in"
refuse "a capability compose.yaml lacks" unraid-npmpro.xml 's|--cap-add=CHOWN|--cap-add=CHOWN --cap-add=NET_ADMIN|' "ExtraParams adds"
refuse "a PUID capability missing" unraid-npmpro.xml 's| --cap-add=FOWNER||' "ExtraParams adds"
refuse "no cap-drop" unraid-npmpro.xml 's|--cap-drop=ALL ||' "ExtraParams has no --cap-drop=ALL"
refuse "another flag" unraid-npmpro.xml 's|</ExtraParams>| --privileged</ExtraParams>|' "ExtraParams has --privileged"
refuse "compose cap_add grew" compose.yaml 's|^      - CHOWN|      - CHOWN\n      - NET_RAW|' "ExtraParams adds"
refuse "host network" unraid-npmpro.xml 's|<Network>bridge|<Network>host|' "Network is not bridge"
refuse "another image" unraid-npmpro.xml 's|ghcr.io/theblackbush/npmpro:|docker.io/someone/npmpro:|' "Repository is not"

[ "$failed" = 0 ] && echo "check-unraid-template: all passed"
exit "$failed"
