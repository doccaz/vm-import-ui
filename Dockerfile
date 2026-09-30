# Dockerfile
# Defines the multi-stage build process for the add-on.

# Stage 1: Build the React frontend
# Use --platform=$BUILDPLATFORM to ensure this stage runs on the runner's native architecture
FROM --platform=$BUILDPLATFORM node:18 AS builder
WORKDIR /app
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install
COPY frontend/ ./
RUN yarn build

# Stage 2: Build the Go backend
# Use --platform=$BUILDPLATFORM to ensure this stage also runs natively
FROM --platform=$BUILDPLATFORM golang:1.24 AS go-builder
WORKDIR /go/src/app

# --> ADD THIS LINE <--
# Accept the target architecture as a build argument from Docker Buildx
ARG TARGETARCH

COPY go.mod ./
COPY pkg/ ./
RUN go mod tidy

# --> MODIFY THIS LINE <--
# Use TARGETARCH to tell Go which architecture to build for (e.g., amd64, arm64)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -v -o /go/bin/vm-import-ui .

# Stage 3: Create the final image
# This stage will be built for the target platform
FROM registry.suse.com/bci/bci-base:latest
WORKDIR /
ENV KUBECONFIG="/kubeconfig"

# qemu-img is required by the VM export worker (`vm-import-ui export-worker`),
# which converts a VM's raw block devices into stream-optimized VMDK / qcow2.
# The same image serves the API and the export Job, so there is one build and
# one version to keep in sync.
RUN zypper --non-interactive --gpg-auto-import-keys refresh && \
    zypper --non-interactive install --no-recommends qemu-tools && \
    zypper --non-interactive clean --all && \
    qemu-img --version

COPY --from=go-builder /go/bin/vm-import-ui /usr/local/bin/vm-import-ui
COPY --from=builder /app/build /ui
EXPOSE 8080
USER 1001
ENTRYPOINT ["/usr/local/bin/vm-import-ui"]