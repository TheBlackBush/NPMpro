#!/usr/bin/env python3
"""Checks the Unraid template unraid-npmpro.xml and ca_profile.xml at the repository root.

Fails when a file does not parse; when TemplateURL or an Icon is not the raw URL on main of a file in the repository
(the icon a 256 x 256 PNG); when the template names a variable NPMpro does not read (NPMPRO_STARTUP_ENVS,
NPMPRO_RUNTIME_ENVS and NPMPRO_SECRET_ENVS in envs.sh, and NAME_FILE for a secret NAME) or sets a port variable; when
a secret value is not masked; when its container ports, WebUI or Extra Parameters differ from the defaults of envs.sh
and compose.yaml (the capabilities of compose.yaml, with the ones it names for PUID/PGID, cap-drop ALL and
no-new-privileges).
Usage, from anywhere: python3 -I .github/scripts/check-unraid-template.py [repository root, default .]
Python 3 standard library only.
"""

import re
import struct
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

RAW = "https://raw.githubusercontent.com/TheBlackBush/NPMpro/main/"
PROJECT = "https://github.com/TheBlackBush/NPMpro"
IMAGE = "ghcr.io/theblackbush/npmpro:"
TEMPLATE = "unraid-npmpro.xml"
PROFILE = "ca_profile.xml"
ENVS = "rootfs/usr/local/bin/envs.sh"
COMPOSE = "compose.yaml"
ICON_SIZE = 256
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PORT_VARS = ("NPM_PORT", "HTTP_PORT", "HTTPS_PORT")
CONFIG_ATTRIBUTES = ("Name", "Target", "Default", "Mode", "Description", "Type", "Display", "Required", "Mask")
# a variable whose value the Unraid UI must hide
SECRET_NAME = re.compile(r"(PASSWORD|SECRET|_KEY)$")
PUID_NOTE = "required if you change PUID/PGID"

errors = []


def fail(message):
    errors.append(message)


def parse(root, name, tag):
    try:
        element = ET.parse(root / name).getroot()
    except (OSError, ET.ParseError) as error:
        fail(f"{name} does not parse: {error}")
        return None
    if element.tag != tag:
        fail(f"{name}: the root element is {element.tag}, not {tag}")
        return None
    return element


def text(element, tag):
    return (element.findtext(tag) or "").strip()


def env_list(envs, name):
    match = re.search(rf'^{name}="([^"]*)"$', envs, re.MULTILINE)
    if not match:
        fail(f"{ENVS} has no {name} line")
        return set()
    return set(match.group(1).split())


def port_defaults(envs, compose):
    """the default port of each PORT_VARS name, from envs.sh; compose.yaml's comment must say the same"""
    ports = {}
    for name in PORT_VARS:
        in_envs = re.search(rf'^export {name}="\$\{{{name}:-(\d+)\}}"$', envs, re.MULTILINE)
        in_compose = re.search(rf'"{name}=[^"]*" #.*?default (\d+)', compose)
        if not in_envs or not in_compose:
            fail(f"no default of {name} in {ENVS} or in {COMPOSE}")
            continue
        if in_envs.group(1) != in_compose.group(1):
            fail(f"{name}: default {in_envs.group(1)} in {ENVS}, {in_compose.group(1)} in {COMPOSE}")
        ports[name] = in_envs.group(1)
    return ports


def compose_caps(compose):
    """the cap_add list of compose.yaml: the active ones and the commented ones it names for PUID/PGID"""
    active, puid = set(), set()
    inside = False
    for line in compose.splitlines():
        if line.strip() == "cap_add:":
            inside = True
            continue
        if inside:
            match = re.match(r"^(#?)\s+- ([A-Z_]+)(.*)$", line)
            if not match:
                break
            if not match.group(1):
                active.add(match.group(2))
            elif PUID_NOTE in match.group(3):
                puid.add(match.group(2))
    if not active:
        fail(f"no cap_add list in {COMPOSE}")
    return active, puid


def check_icon(root, where, url):
    if not url.startswith(RAW):
        fail(f"{where} is {url!r}, not a file under {RAW}")
        return
    path = root / url[len(RAW) :]
    if not path.is_file():
        fail(f"{where} points to {url[len(RAW) :]}, which is not in the repository")
        return
    head = path.read_bytes()[:24]
    if len(head) < 24 or head[:8] != PNG_MAGIC or head[12:16] != b"IHDR":
        fail(f"{where} is not a PNG")
        return
    size = struct.unpack(">II", head[16:24])
    if size != (ICON_SIZE, ICON_SIZE):
        fail(f"{where} is {size[0]} x {size[1]}, not {ICON_SIZE} x {ICON_SIZE}")


def check_profile(root):
    profile = parse(root, PROFILE, "CommunityApplications")
    if profile is None:
        return
    if not text(profile, "Profile"):
        fail(f"{PROFILE} has an empty Profile")
    check_icon(root, f"{PROFILE} Icon", text(profile, "Icon"))
    if text(profile, "WebPage") != PROJECT:
        fail(f"{PROFILE} WebPage is not {PROJECT}")


def check_variable(name, config, readable, secret):
    base = name.removesuffix("_FILE")
    if name == "TZ":
        fail(f"{TEMPLATE} sets TZ: Unraid passes the server's time zone to every container")
    elif name in PORT_VARS:
        fail(f"{TEMPLATE} sets {name}: the container keeps its default ports, the mapping sets the outside ones")
    elif name.endswith("_FILE") and base not in secret:
        fail(f"{TEMPLATE} names {name}, but {base} cannot be read from a file (NPMPRO_SECRET_ENVS in {ENVS})")
    elif not name.endswith("_FILE") and name not in readable:
        fail(f"{TEMPLATE} names {name}, which NPMpro does not read (the lists in {ENVS})")
    if name.endswith("_FILE") and config.get("Default"):
        fail(f"{TEMPLATE}: {name} has a default; a _FILE variable is empty unless the user sets it")
    if SECRET_NAME.search(name) and config.get("Mask") != "true":
        fail(f"{TEMPLATE}: {name} is not masked")


def check_configs(template, envs, ports):
    secret = env_list(envs, "NPMPRO_SECRET_ENVS")
    readable = env_list(envs, "NPMPRO_STARTUP_ENVS") | env_list(envs, "NPMPRO_RUNTIME_ENVS") | secret
    found_ports, host_ports = set(), set()
    for config in template.iter("Config"):
        name = config.get("Target", "")
        missing = [attribute for attribute in CONFIG_ATTRIBUTES if attribute not in config.attrib]
        if missing:
            fail(f"{TEMPLATE}: Config {name or '?'} has no {', '.join(missing)}")
        if (config.text or "") != config.get("Default", ""):
            fail(f"{TEMPLATE}: Config {name} has a value other than its Default")
        kind = config.get("Type")
        if kind == "Variable":
            check_variable(name, config, readable, secret)
        elif kind == "Port":
            found_ports.add((name, config.get("Mode")))
            host = (config.get("Default"), config.get("Mode"))
            if host in host_ports:
                fail(f"{TEMPLATE}: host port {host[0]}/{host[1]} is mapped twice")
            host_ports.add(host)
        elif kind == "Path":
            if name == "/run/secrets" and config.get("Mode") != "ro":
                fail(f"{TEMPLATE}: /run/secrets is not read-only")
        else:
            fail(f"{TEMPLATE}: Config {name} has the type {kind!r}")
    if len(ports) == len(PORT_VARS):
        expected = {
            (ports["NPM_PORT"], "tcp"),
            (ports["HTTP_PORT"], "tcp"),
            (ports["HTTPS_PORT"], "tcp"),
            (ports["HTTPS_PORT"], "udp"),
        }
        if found_ports != expected:
            fail(f"{TEMPLATE}: the container ports are {sorted(found_ports)}, expected {sorted(expected)}")


def check_extra_params(template, compose):
    active, puid = compose_caps(compose)
    params = text(template, "ExtraParams").split()
    for required in ("--cap-drop=ALL", "--security-opt=no-new-privileges:true"):
        if required not in params:
            fail(f"{TEMPLATE}: ExtraParams has no {required}")
    caps = set()
    for param in params:
        if param.startswith("--cap-add="):
            caps.add(param.removeprefix("--cap-add="))
        elif param not in ("--cap-drop=ALL", "--security-opt=no-new-privileges:true"):
            fail(f"{TEMPLATE}: ExtraParams has {param}, which {COMPOSE} does not set")
    if caps != active | puid:
        fail(f"{TEMPLATE}: ExtraParams adds {sorted(caps)}, {COMPOSE} {sorted(active | puid)} (cap_add and PUID/PGID)")


def check_template(root, envs, compose):
    template = parse(root, TEMPLATE, "Container")
    if template is None:
        return
    if template.get("version") != "2":
        fail(f'{TEMPLATE}: Container has no version="2"')
    if text(template, "Name") != "NPMpro":
        fail(f"{TEMPLATE}: Name is not NPMpro")
    if not text(template, "Repository").startswith(IMAGE):
        fail(f"{TEMPLATE}: Repository is not {IMAGE}<tag>")
    if text(template, "TemplateURL") != RAW + TEMPLATE:
        fail(f"{TEMPLATE}: TemplateURL is not {RAW + TEMPLATE}")
    check_icon(root, f"{TEMPLATE} Icon", text(template, "Icon"))
    if text(template, "Project") != PROJECT or text(template, "Support") != f"{PROJECT}/issues":
        fail(f"{TEMPLATE}: Project or Support is not {PROJECT}")
    if text(template, "Network") != "bridge" or text(template, "Privileged") != "false":
        fail(f"{TEMPLATE}: Network is not bridge or Privileged is not false")
    ports = port_defaults(envs, compose)
    if "NPM_PORT" in ports and text(template, "WebUI") != f"https://[IP]:[PORT:{ports['NPM_PORT']}]":
        fail(f"{TEMPLATE}: WebUI is not https://[IP]:[PORT:{ports['NPM_PORT']}]")
    check_configs(template, envs, ports)
    check_extra_params(template, compose)


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    try:
        envs = (root / ENVS).read_text(encoding="utf-8")
        compose = (root / COMPOSE).read_text(encoding="utf-8")
    except OSError as error:
        print(f"Cannot read {ENVS} or {COMPOSE}: {error}")
        return 1
    check_profile(root)
    check_template(root, envs, compose)
    if errors:
        print("The Unraid template does not match NPMpro:")
        print("\n".join(errors))
        return 1
    print(f"{TEMPLATE} and {PROFILE} match NPMpro")
    return 0


if __name__ == "__main__":
    sys.exit(main())
