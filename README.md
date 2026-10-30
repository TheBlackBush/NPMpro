<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/TheBlackBush/NPMpro/develop/.github/images/brand/npmpro-stacked-dark.svg">
    <img src="https://raw.githubusercontent.com/TheBlackBush/NPMpro/develop/.github/images/brand/npmpro-stacked-light.svg" alt="NPMpro" width="300">
  </picture>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-in%20heavy%20development-orange?style=for-the-badge" alt="Status: in heavy development">
  <a href="https://github.com/TheBlackBush/NPMpro/actions/workflows/docker.yml"><img src="https://img.shields.io/github/actions/workflow/status/TheBlackBush/NPMpro/docker.yml?branch=develop&style=for-the-badge&label=docker%20build" alt="Docker build"></a>
  <a href="https://github.com/TheBlackBush/NPMpro/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/TheBlackBush/NPMpro/test.yml?branch=develop&style=for-the-badge&label=tests" alt="Tests"></a>
  <a href="https://github.com/TheBlackBush/NPMpro/blob/main/COPYING"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=for-the-badge" alt="License AGPL-3.0"></a>
  <a href="https://github.com/TheBlackBush/NPMpro/pkgs/container/npmpro"><img src="https://img.shields.io/badge/image-npmpro-blue?style=for-the-badge&logo=github" alt="GHCR package"></a>
  <a href="https://github.com/TheBlackBush/NPMpro/pkgs/container/npmpro"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2FTheBlackBush%2FNPMpro%2Fnpmpro&query=downloadCount&label=ghcr%20pulls&style=for-the-badge&logo=docker&logoColor=white" alt="GHCR pulls"></a>
  <a href="https://hub.docker.com/r/blackbush/npmpro"><img src="https://img.shields.io/docker/pulls/blackbush/npmpro?style=for-the-badge&logo=docker&logoColor=white&label=docker%20hub%20pulls" alt="Docker Hub pulls"></a>
  <img src="https://img.shields.io/badge/platforms-amd64v2%20%7C%20arm64-informational?style=for-the-badge" alt="Platforms amd64v2 and arm64">
  <a href="https://ko-fi.com/M4M11W3R7J"><img src="https://img.shields.io/badge/support_me_on_ko--fi-F16061?style=for-the-badge&logo=kofi&logoColor=f5f5f5" alt="Ko-fi"></a>
</p>

> [!WARNING]
> **NPMpro is in heavy development and has not been released yet.**
> There is no stable release. The `develop` image (`ghcr.io/theblackbush/npmpro:develop`, `blackbush/npmpro:develop`) changes often, can break, and is for testing only. Do not use it for anything you depend on.

## What is NPMpro?

NPMpro is a reverse proxy with a web UI: you add your domains, point them at your services and get HTTPS certificates, without writing nginx configs.
It is a hardened fork of NPMplus and nginx-proxy-manager, shipped as one Docker image with a custom-compiled nginx (HTTP/3, brotli/zstd, ECH), a Node.js backend and a React web UI.

## Where to look

- Code and current work: the [`develop` branch](https://github.com/TheBlackBush/NPMpro/tree/develop). This `main` branch only holds the initial import until the first release.
- Documentation: the [wiki](https://github.com/TheBlackBush/NPMpro/wiki)
- Questions and bugs: [issues](https://github.com/TheBlackBush/NPMpro/issues)

## License and credits

NPMpro is licensed under AGPL-3.0, with parts under MIT (see [COPYING](https://github.com/TheBlackBush/NPMpro/blob/main/COPYING) and [MIT.LICENSE](https://github.com/TheBlackBush/NPMpro/blob/main/MIT.LICENSE)).

Based on [NPMplus](https://github.com/ZoeyVid/NPMplus) by ZoeyVid, which is based on [Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager) by jc21.
