# backend/Dockerfile
# Multi-stage: install deps, then slim production image

FROM node:20-alpine AS base
WORKDIR /app

# Install system deps for Puppeteer/chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Tell Puppeteer to use installed Chromium, not download its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production

# ── Production image ──────────────────────────────────────────────────────────
FROM base AS production
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodeuser -u 1001

# Copy deps and source
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=nodeuser:nodejs . .

# Create required directories
RUN mkdir -p logs uploads/payslips uploads/avatars && \
    chown -R nodeuser:nodejs logs uploads

USER nodeuser

EXPOSE 3000

# Use node directly for production (not nodemon)
CMD ["node", "src/index.js"]
