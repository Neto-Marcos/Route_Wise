FROM postgres:18-alpine
RUN apk add --no-cache nodejs npm
WORKDIR /opt/operations
COPY ops/jobs/package.json ops/jobs/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY ops/jobs/ ./
RUN chown -R postgres:postgres /opt/operations
USER postgres
CMD ["node", "backup.mjs"]
