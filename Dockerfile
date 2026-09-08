# Registry / directory check image (Glama, MCP Registry).
# The real product runs on the user's machine: the MCP server pairs with the Chrome extension over
# localhost. This image starts the stdio MCP server so registries can introspect its tools; LinkedIn
# calls will report EXTENSION_OFFLINE until an extension is paired. Do not deploy this as a service.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY mcp-server ./mcp-server
COPY docs/actions.md ./docs/actions.md
RUN npm ci --workspace mcp-server --include-workspace-root=false --no-audit --no-fund \
 && npm run build --workspace mcp-server
ENV LINKEDIN_TOOLKIT_HOME=/data
RUN mkdir -p /data
ENTRYPOINT ["node", "mcp-server/dist/server.js"]
