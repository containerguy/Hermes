# Windows-Agent für „Spielt gerade“ (tools/game-agent); Matchdesk liefert ihn unter
# GET /api/presence/agent/download aus, damit er auch im LAN ohne Internet zu haben ist.
FROM golang:1.26-bookworm AS agent

WORKDIR /src
COPY tools/game-agent/go.mod tools/game-agent/go.sum ./
RUN go mod download
COPY tools/game-agent/ ./
RUN CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/matchdesk-game-agent.exe .

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    MATCHDESK_HOST=0.0.0.0 \
    MATCHDESK_PORT=3000 \
    MATCHDESK_DB_PATH=/data/matchdesk.sqlite

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=agent /out/matchdesk-game-agent.exe ./agent/matchdesk-game-agent.exe

RUN mkdir -p /data

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist-server/index.js"]
