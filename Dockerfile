# =============================================================================
# Orchestrator - Multi-stage Dockerfile
# Optimized for layer caching and minimal build times
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Frontend Dependencies
# Cached until package.json or package-lock.json changes
# -----------------------------------------------------------------------------
FROM node:22-alpine AS frontend-deps

WORKDIR /app/frontend

# Copy only package files first for dependency caching
COPY frontend/package*.json ./

# Install dependencies (cached unless package files change)
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 2: Frontend Build
# Rebuilds when source changes, but deps layer is cached
# -----------------------------------------------------------------------------
FROM frontend-deps AS frontend-build

WORKDIR /app/frontend

# Copy source files
COPY frontend/tsconfig*.json ./
COPY frontend/vite.config.ts ./
COPY frontend/index.html ./
COPY frontend/src ./src
COPY frontend/public ./public

# Build frontend (outputs to dist/ with content-hashed filenames)
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3: Server Dependencies
# Cached until package.json or package-lock.json changes
# node-pty requires build tools for native addon compilation
# -----------------------------------------------------------------------------
FROM node:22-alpine AS server-deps

# Install build dependencies for node-pty native addon
RUN apk add --no-cache python3 make g++

WORKDIR /app/server

# Copy only package files first for dependency caching
COPY server/package*.json ./

# Install all dependencies including devDependencies for TypeScript build
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 4: Server Build
# Rebuilds when source changes, but deps layer is cached
# -----------------------------------------------------------------------------
FROM server-deps AS server-build

WORKDIR /app/server

# Copy TypeScript config and source
COPY server/tsconfig.json ./
COPY server/src ./src

# Build TypeScript to JavaScript
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 5: Production Dependencies Only
# Slim install without devDependencies
# -----------------------------------------------------------------------------
FROM node:22-alpine AS server-prod-deps

# Install build dependencies for node-pty native addon
RUN apk add --no-cache python3 make g++

WORKDIR /app/server

COPY server/package*.json ./

# Production-only install (no devDependencies)
RUN npm ci --omit=dev

# -----------------------------------------------------------------------------
# Stage 6: Final Production Image
# Minimal image with only runtime requirements
# -----------------------------------------------------------------------------
FROM node:22-alpine AS production

# Install runtime dependencies
# tmux is required for agent terminal sessions
# git, curl for agent operations
RUN apk add --no-cache tmux git curl

# Create non-root user for security
RUN addgroup -g 1001 -S orchestrator && \
    adduser -S -u 1001 -G orchestrator orchestrator

WORKDIR /app

# Copy built frontend (static files)
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Copy server production dependencies
COPY --from=server-prod-deps /app/server/node_modules ./server/node_modules

# Copy built server
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/package.json ./server/

# Create data directory with correct permissions
RUN mkdir -p /app/data && chown -R orchestrator:orchestrator /app

# Switch to non-root user
USER orchestrator

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data

# Expose the server port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/mayor/status || exit 1

# Start the server
WORKDIR /app/server
CMD ["node", "dist/server.js"]
