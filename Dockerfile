# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/

# Install dependencies
RUN npm ci

# Copy source code
COPY server server/
COPY client client/

# Build server and client
RUN npm run build

# Runtime stage
FROM node:22-alpine

WORKDIR /app

# Install pg for database operations
RUN apk add --no-cache postgresql-client

# Copy package files
COPY package.json package-lock.json ./
COPY server/package.json server/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built server from builder
COPY --from=builder /app/server/dist server/dist
COPY --from=builder /app/server/drizzle server/drizzle

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start with migrations
CMD ["npm", "start", "-w", "server"]
