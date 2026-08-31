FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_ORIGIN=http://localhost:4000
ARG VITE_CUSTOMER_ORIGIN=http://localhost:5173
ARG VITE_PRODUCT_NAME="Restaurant Platform"
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_APP_ID=""
ARG VITE_FIREBASE_MESSAGING_SENDER_ID=""
ARG VITE_FIREBASE_MEASUREMENT_ID=""
ARG VITE_SALES_URL=""
ARG VITE_BRAND_WORDMARK=/brand-wordmark.png
ENV VITE_API_ORIGIN=$VITE_API_ORIGIN
ENV VITE_CUSTOMER_ORIGIN=$VITE_CUSTOMER_ORIGIN
ENV VITE_PRODUCT_NAME=$VITE_PRODUCT_NAME
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID
ENV VITE_SALES_URL=$VITE_SALES_URL
ENV VITE_BRAND_WORDMARK=$VITE_BRAND_WORDMARK
COPY package*.json tsconfig.base.json ./
COPY apps/restaurant-dashboard/package.json apps/restaurant-dashboard/package.json
COPY packages/shared-types packages/shared-types
RUN npm ci --workspace @whitelabel/restaurant-dashboard --workspace @whitelabel/shared-types
COPY apps/restaurant-dashboard apps/restaurant-dashboard
RUN npm run build -w @whitelabel/restaurant-dashboard

FROM nginx:1.27-alpine
COPY infra/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/restaurant-dashboard/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
