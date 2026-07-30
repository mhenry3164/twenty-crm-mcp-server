FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./

USER node

# MCP stdio server: run with -i so the client can speak JSON-RPC over stdin.
#   docker run -i --rm -e TWENTY_API_KEY -e TWENTY_BASE_URL twenty-crm-mcp-server
ENTRYPOINT ["node", "index.js"]
