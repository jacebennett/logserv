FROM denoland/deno AS builder

WORKDIR /app
COPY . .
RUN deno task build


FROM debian:bullseye-slim
RUN apt-get update && \
    apt-get install -y ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir /logs
COPY --from=builder /app/logserv /app/logserv

EXPOSE 1065

WORKDIR /logs
CMD ["/app/logserv"]
