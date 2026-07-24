FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production     IDENSTR_BIND_HOST=0.0.0.0     IDENSTR_BIND_PORT=3000     IDENSTR_DB_STORE=/data/idenstr.db     IDENSTR_TOKEN_STORE=/data/api-tokens.json     IDENSTR_STATE_STORE=/data/idenstr-state.json

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY README.md ./README.md

# Run as the node user (uid 1000, gid 1000, already present in node:alpine) so the
# host-mounted .env and the data volume line up with a standard host user and the
# dashboard can persist edits to .env.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3   CMD node -e "fetch('http://127.0.0.1:3000/api/v1/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
