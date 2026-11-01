# Stream Syncer (self-hosted, Docker)
#
#   docker build -t stream-syncer .
#   docker run -p 8080:8080 stream-syncer
#
# Bouwt de app en serveert hem met een kleine Node-server die ook de
# Twitch-proxy verzorgt (zie server/index.mjs).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
CMD ["node", "server/index.mjs"]
