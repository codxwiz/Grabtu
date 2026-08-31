FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_ORIGIN=http://localhost:4000
ARG VITE_DASHBOARD_ORIGIN=http://localhost:5174
ARG VITE_PRODUCT_NAME="Restaurant Platform"
ARG VITE_SUPPORT_EMAIL=support@example.com
ENV VITE_API_ORIGIN=$VITE_API_ORIGIN
ENV VITE_DASHBOARD_ORIGIN=$VITE_DASHBOARD_ORIGIN
ENV VITE_PRODUCT_NAME=$VITE_PRODUCT_NAME
ENV VITE_SUPPORT_EMAIL=$VITE_SUPPORT_EMAIL
COPY package*.json tsconfig.base.json ./
COPY apps/customer-web/package.json apps/customer-web/package.json
COPY packages/shared-types packages/shared-types
RUN npm ci --workspace @whitelabel/customer-web --workspace @whitelabel/shared-types
COPY apps/customer-web apps/customer-web
RUN npm run build -w @whitelabel/customer-web

FROM nginx:1.27-alpine
COPY infra/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/customer-web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
