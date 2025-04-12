# Install dependencies only when needed
# Stage 0
FROM imbios/bun-node AS deps
WORKDIR /app

COPY package.json ./

RUN bun i
#############################################

# Rebuild the source code only when needed
# Stage 1
FROM imbios/bun-node AS builder
WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN bun run build-scrape
#############################################


# Production image, copy only production files
# Stage 2
FROM imbios/bun-node AS prod

USER root

# Install necessary dependencies for running Chrome
RUN apt-get update && apt-get install -y \
  wget \
  gnupg \
  ca-certificates \
  apt-transport-https \
  xvfb \
  && rm -rf /var/lib/apt/lists/*

# Install Google Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && echo "deb [arch=amd64] https://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
  && apt-get update \
  && apt-get install -y google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/node_modules ./node_modules

RUN npx puppeteer browsers install chrome

CMD ["bun", "start"]