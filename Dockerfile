# Everborn Command hosted hub. Build context = the command-center folder.
# Runs the same server as the desktop app in hosted mode; all state lives in Supabase.
# This image is the hosted web app and the Extreme job worker (server/worker-service.js
# is loaded by server/index.js). Nothing in this file is a secret. Set keys on the host.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node server ./server
COPY --chown=node:node web ./web
COPY --chown=node:node release ./release
ENV CC_MODE=hosted PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
# 0.4.22 (Aikido): the app runs as the image's non-root node user, not as root.
USER node
CMD ["node", "server/index.js"]
