FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY services/api/package.json services/api/package.json
COPY packages/shared-types packages/shared-types
RUN npm ci --workspace @whitelabel/api --workspace @whitelabel/shared-types
COPY services/api services/api
RUN npm run build -w @whitelabel/api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/services/api/dist services/api/dist
COPY --from=build /app/services/api/prisma services/api/prisma
COPY --from=build /app/services/api/package.json services/api/package.json
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","services/api/dist/index.js"]
