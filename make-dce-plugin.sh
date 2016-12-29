#!/usr/bin/env bash
set -e

make generate-webui
make binary

docker build -f dce-plugin.Dockerfile -t daocloud.io/daocloud/dce-plugin-traefik .
