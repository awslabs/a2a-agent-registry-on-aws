# Multi-stage build for React application
FROM node:24-alpine AS build

# Set working directory
WORKDIR /app

# Install curl for health checks (needed in build stage for dependencies)
RUN apk add --no-cache curl

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build arguments for environment variables
ARG REACT_APP_API_GATEWAY_URL
ARG REACT_APP_AWS_REGION
ARG REACT_APP_IDENTITY_POOL_ID

# Set environment variables for build
ENV REACT_APP_API_GATEWAY_URL=${REACT_APP_API_GATEWAY_URL}
ENV REACT_APP_AWS_REGION=${REACT_APP_AWS_REGION}
ENV REACT_APP_IDENTITY_POOL_ID=${REACT_APP_IDENTITY_POOL_ID}

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Create a non-root user for the container
RUN addgroup -g 1001 -S appgroup && \
    adduser -S -D -H -u 1001 -h /var/cache/nginx -s /sbin/nologin -G appgroup -g appgroup appuser

# Copy built application from build stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Create a script to handle runtime environment variables
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Change ownership of nginx directories to appuser
RUN chown -R appuser:appgroup /var/cache/nginx && \
    chown -R appuser:appgroup /var/log/nginx && \
    chown -R appuser:appgroup /etc/nginx/conf.d && \
    chown -R appuser:appgroup /usr/share/nginx/html && \
    touch /var/run/nginx.pid && \
    chown -R appuser:appgroup /var/run/nginx.pid

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/health || exit 1

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 80

# Use custom entrypoint to handle runtime environment variables
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]