FROM node:22-alpine AS client-build

WORKDIR /app

# Install the workspace dependencies before copying the application source so
# Docker can reuse this layer when only frontend code changes.
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

COPY client client

# The browser talks to Nginx on the same origin. The service injects the
# public Supabase URL and anon key at image-build time, never server secrets.
ARG VITE_API_URL=/api
ARG VITE_SUPABASE_URL=http://localhost:8080
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build -w client

FROM nginx:1.27-alpine

COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=client-build /app/client/dist /usr/share/nginx/html
