FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
COPY packages/engine/package.json packages/engine/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 DATABASE_PATH=/app/data/tournaments.sqlite
COPY --from=build --chown=1000:1000 /app/apps/web/.next/standalone ./
COPY --from=build --chown=1000:1000 /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=1000:1000 /app/apps/web/public ./apps/web/public
RUN mkdir -p /app/data && chown 1000:1000 /app/data
USER 1000:1000
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
