FROM golang:1.25-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /bin/api .

FROM alpine:3.20
# ffmpeg normalizes IVR sound uploads to the FreeSWITCH-canonical WAV.
RUN apk --no-cache add ca-certificates ffmpeg
WORKDIR /app
COPY --from=builder /bin/api .
COPY migrations ./migrations
RUN mkdir -p uploads/sounds uploads/ivr

EXPOSE 3003
CMD ["./api"]
