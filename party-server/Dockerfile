FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs ./
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4680
# Local health checks inside the container (not exposed publicly unless you map the port)
ENV HEALTH_HOST=127.0.0.1
ENV HEALTH_PORT=4681
EXPOSE 4680
HEALTHCHECK --interval=30s --timeout=5s --start-period=8s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4681/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.mjs"]
