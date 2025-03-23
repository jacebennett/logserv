FROM denoland/deno:alpine AS builder

WORKDIR /app
COPY . .
RUN deno task build


FROM alpine:latest
RUN apk --no-cache add ca-certificates && mkdir /logs
COPY --from=builder /app/logserv /app/logserv

EXPOSE 1065

WORKDIR /logs
CMD ["/app/logserv"]
