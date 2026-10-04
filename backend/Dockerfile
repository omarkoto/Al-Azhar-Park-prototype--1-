# Al-Azhar Park API — production image.  Build context: ./backend
#   docker build -t azharpark-api ./backend
# Node 22 LTS is the production target.

FROM node:22-bookworm-slim AS base
WORKDIR /app
# Prisma's query engine needs OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ── dependencies (cached until package files change) ──
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate

# ── compile ──
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ── runtime: production dependencies + compiled code only ──
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts && npx prisma generate && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && mkdir -p storage && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
