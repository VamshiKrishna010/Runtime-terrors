# Production build served by nginx (not the Vite dev server).
FROM node:22.12-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ARG CONVEX_URL
ARG VITE_API_URL=/api
ARG VITE_ML_SERVICE_URL=/ml
ENV CONVEX_URL=$CONVEX_URL VITE_API_URL=$VITE_API_URL VITE_ML_SERVICE_URL=$VITE_ML_SERVICE_URL
RUN test -n "$CONVEX_URL" || (echo "CONVEX_URL build arg is required" && exit 1)
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27.3-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
