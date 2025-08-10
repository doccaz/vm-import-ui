# Stage 1: Build the React frontend
FROM node:18 AS builder
WORKDIR /app
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install
COPY frontend/ ./
RUN yarn build

# Stage 2: Build the Go backend
FROM golang:1.21 AS go-builder
WORKDIR /go/src/app

# Copy the module file first
COPY go.mod ./

# Copy the Go source code from the 'pkg' directory
COPY pkg/ ./

# Run 'go mod tidy'. This will analyze the source code's imports, 
# update go.mod if necessary, create the go.sum file, 
# and download all required dependencies.
RUN go mod tidy

# Build the application.
RUN CGO_ENABLED=0 GOOS=linux go build -v -o /go/bin/vm-import-ui .

# Stage 3: Create the final image
FROM gcr.io/distroless/static-debian11
WORKDIR /
COPY --from=go-builder /go/bin/vm-import-ui /
COPY --from=builder /app/build /ui
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/vm-import-ui"]s