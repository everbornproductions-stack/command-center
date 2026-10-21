# Everborn Command hosted hub. Build context = the command-center folder.
# Runs the same server as the desktop app in hosted mode; all state lives in Supabase.
# This image is the hosted web app and the Extreme job worker (server/worker-service.js
# is loaded by server/index.js). Nothing in this file is a secret. Set keys on the host.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server ./server
COPY web ./web
COPY release ./release
ENV CC_MODE=hosted PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server/index.js"]
