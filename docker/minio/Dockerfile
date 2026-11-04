# 从固定的 MinIO 官方源码构建服务端与客户端；部署接线见 docker/README.md。
FROM --platform=$BUILDPLATFORM golang:1.26.10-trixie@sha256:a050dcceee6eb9bf110151662dfac7662f3bec40927c7dee48731e3d92083d42 AS go-builder

ENV CGO_ENABLED=0 \
    GOTOOLCHAIN=local \
    GOFLAGS=-mod=readonly \
    GOPROXY=https://proxy.golang.org \
    GOSUMDB=sum.golang.org

WORKDIR /src

FROM go-builder AS minio-build
ARG TARGETOS
ARG TARGETARCH

RUN curl --fail --show-error --silent --location \
      --connect-timeout 15 --max-time 180 \
      https://codeload.github.com/minio/minio/tar.gz/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a \
      --output /tmp/minio.tar.gz \
 && echo '45521908307306e925c98d629e1c17d78c8b72b6ee242b1bfb1409f7d8ee5841  /tmp/minio.tar.gz' | sha256sum --check --strict \
 && tar --extract --gzip --file /tmp/minio.tar.gz --strip-components=1 \
 && rm /tmp/minio.tar.gz

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" go build \
      -trimpath -buildvcs=false -tags kqueue \
      -ldflags='-s -w -X github.com/minio/minio/cmd.Version=2025-10-15T17:29:55Z -X github.com/minio/minio/cmd.ReleaseTag=RELEASE.2025-10-15T17-29-55Z -X github.com/minio/minio/cmd.CommitID=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a -X github.com/minio/minio/cmd.ShortCommitID=9e49d5e7a648 -X github.com/minio/minio/cmd.CopyrightYear=2025' \
      -o /out/minio .

FROM go-builder AS mc-build
ARG TARGETOS
ARG TARGETARCH

RUN curl --fail --show-error --silent --location \
      --connect-timeout 15 --max-time 180 \
      https://codeload.github.com/minio/mc/tar.gz/7394ce0dd2a80935aded936b09fa12cbb3cb8096 \
      --output /tmp/mc.tar.gz \
 && echo '95cd293c7119f16921a6dc515a1fb74a2227f19fd994b9c8b770a154e802ac44  /tmp/mc.tar.gz' | sha256sum --check --strict \
 && tar --extract --gzip --file /tmp/mc.tar.gz --strip-components=1 \
 && rm /tmp/mc.tar.gz

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" go build \
      -trimpath -buildvcs=false -tags kqueue \
      -ldflags='-s -w -X github.com/minio/mc/cmd.Version=2025-08-13T08:35:41Z -X github.com/minio/mc/cmd.ReleaseTag=RELEASE.2025-08-13T08-35-41Z -X github.com/minio/mc/cmd.CommitID=7394ce0dd2a80935aded936b09fa12cbb3cb8096 -X github.com/minio/mc/cmd.ShortCommitID=7394ce0dd2a8 -X github.com/minio/mc/cmd.CopyrightYear=2025' \
      -o /out/mc .

FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4 AS runtime
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 minio \
 && useradd --uid 10001 --gid minio --create-home \
      --shell /usr/sbin/nologin minio

ENV HOME=/home/minio \
    MC_CONFIG_DIR=/tmp/.mc

FROM runtime AS server
LABEL org.opencontainers.image.title="MinIO" \
      org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a" \
      org.opencontainers.image.version="RELEASE.2025-10-15T17-29-55Z" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.documentation="https://github.com/minio/minio/blob/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a/README.md"

COPY --from=minio-build /out/minio /usr/local/bin/minio
COPY --from=minio-build /src/LICENSE /src/CREDITS /usr/share/licenses/minio/
RUN install --directory --owner=minio --group=minio /data
USER 10001:10001
EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]

FROM runtime AS client
LABEL org.opencontainers.image.title="MinIO Client" \
      org.opencontainers.image.source="https://github.com/minio/mc" \
      org.opencontainers.image.revision="7394ce0dd2a80935aded936b09fa12cbb3cb8096" \
      org.opencontainers.image.version="RELEASE.2025-08-13T08-35-41Z" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.documentation="https://github.com/minio/mc/blob/7394ce0dd2a80935aded936b09fa12cbb3cb8096/README.md"

COPY --from=mc-build /out/mc /usr/local/bin/mc
COPY --from=mc-build /src/LICENSE /src/CREDITS /usr/share/licenses/mc/
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/mc"]
