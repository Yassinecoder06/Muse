FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

COPY server server
RUN npm run build -w server

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev

COPY --from=build /app/server/dist server/dist

EXPOSE 3001
CMD ["node", "server/dist/index.js"]
