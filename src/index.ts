#!/usr/bin/env node

/**
 * MCP server for Google search using Playwright headless browser
 * Provides functionality to search on Google with multiple keywords
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";
import { startHttpServer } from "./http.js";

// Parse command line arguments
export const isDebugMode = process.argv.includes("--debug");
const isHttpMode = process.argv.includes("--http");
const portArg = process.argv.find(arg => arg.startsWith("--port="));
const port = portArg ? parseInt(portArg.split("=")[1], 10) : 3333;
const hostArg = process.argv.find(arg => arg.startsWith("--host="));
const host = hostArg ? hostArg.split("=")[1] : "localhost";

/**
 * Start the server
 */
async function main() {
  logger.info("[Setup] Initializing Google Search MCP server...");

  if (isDebugMode) {
    logger.debug("[Setup] Debug mode enabled, Chrome browser window will be visible");
  }

  if (isHttpMode) {
      startHttpServer(port, host);
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("[Setup] Stdio server started");
  }
}

main().catch((error) => {
  logger.error(`[Error] Server error: ${error}`);
  process.exit(1);
});
