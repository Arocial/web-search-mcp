import { Request, Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { logger } from './utils/logger.js';

/**
 * Create and start the MCP HTTP server
 */
export function startHttpServer(port: number = 3333, host: string = "localhost") {
  logger.info(`Using ${host}`)
  const app = createMcpExpressApp({host});

  app.post('/mcp', async (req: Request, res: Response) => {
    const server = createServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        logger.info('[HTTP] Request closed');
        transport.close();
        server.close();
      });
    } catch (error) {
      logger.error(`[HTTP] Error handling MCP request: ${error}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error'
          },
          id: null
        });
      }
    }
  });

  app.get('/mcp', async (_req: Request, res: Response) => {
    logger.info('[HTTP] Received GET MCP request');
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.'
      },
      id: null
    });
  });

  app.delete('/mcp', async (_req: Request, res: Response) => {
    logger.info('[HTTP] Received DELETE MCP request');
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.'
      },
      id: null
    });
  });

  app.listen(port, () => {
    logger.info(`[HTTP] MCP Stateless Streamable HTTP Server listening on port ${port}`);
  });
}
