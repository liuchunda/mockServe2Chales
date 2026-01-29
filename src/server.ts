#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createProxyServer } from './proxy.js';
import { 
  getConfig, 
  isPortAvailable, 
  findAvailablePort,
  killProcessByPort,
} from './config.js';
import {
  addMockRuleTool,
  removeMockRuleTool,
  listMockRulesTool,
  toggleMockTool,
  getRequestLogsTool,
  generateCharlesConfigTool,
  reloadRulesTool,
  toolHandlers,
} from './tools.js';
import { getRulesManager } from './rules.js';

/**
 * 启动 MCP Mock Server
 */
async function main() {
  const config = getConfig();
  
  // 若配置端口被占用，尝试关闭占用进程后继续（不依赖 PID 文件，避免重启 Cursor 误报）
  try {
    const available = await isPortAvailable(config.port);
    if (!available) {
      console.error(`端口 ${config.port} 被占用，尝试关闭占用进程...`);
      const killed = await killProcessByPort(config.port);
      if (killed) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  } catch (error) {
    console.error(`端口检查失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 初始化 MCP 服务器
  const server = new Server(
    {
      name: 'mcp-mock-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 注册工具列表处理器
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        addMockRuleTool,
        removeMockRuleTool,
        listMockRulesTool,
        toggleMockTool,
        getRequestLogsTool,
        generateCharlesConfigTool,
        reloadRulesTool,
      ],
    };
  });

  // 注册工具调用处理器
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = toolHandlers[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      const result = await handler(args || {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // 启动 HTTP 代理服务器
  const proxyApp = createProxyServer();
  
  // 检查端口是否可用，不可用时尝试关闭占用进程或换端口
  let actualPort = config.port;
  try {
    const available = await isPortAvailable(config.port);
    if (!available) {
      console.error(`端口 ${config.port} 已被占用，尝试关闭占用进程...`);
      const killed = await killProcessByPort(config.port);
      if (killed) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        actualPort = await findAvailablePort(config.port);
        console.error(`无法关闭占用进程，已自动选择端口 ${actualPort}`);
      }
    }
  } catch (error) {
    console.error(`端口检查失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 绑定 127.0.0.1 而非 0.0.0.0，避免部分环境 EPERM（如 Cursor 启动 MCP 时）
  const httpServer = proxyApp.listen(actualPort, '127.0.0.1', () => {
    console.error(`HTTP Proxy Server started on port ${actualPort}`);
    console.error(`Mock rules path: ${config.rulesPath}`);
    if (actualPort !== config.port) {
      console.error(`注意: 配置的端口 ${config.port} 被占用，已使用端口 ${actualPort}`);
      console.error(`请更新 Charles 配置或 mockServe/miMockServerConfig.json 中的端口号为 ${actualPort}`);
    }
  });

  // 处理监听错误：EPERM/无权限时不退出进程，MCP 工具仍可用
  httpServer.on('error', async (error: any) => {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      console.error(`HTTP 代理无法绑定端口（无权限），MCP 工具仍可用: ${error.message}`);
      return;
    }
    if (error.code === 'EADDRINUSE') {
      console.error(`端口 ${actualPort} 被占用，尝试关闭占用进程...`);

      const killed = await killProcessByPort(actualPort);

      if (killed) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        httpServer.close();
        proxyApp.listen(actualPort, '127.0.0.1', () => {
          console.error(`HTTP Proxy Server started on port ${actualPort}`);
          console.error(`Mock rules path: ${config.rulesPath}`);
        });
      } else {
        console.error(`无法关闭占用端口的进程，尝试使用其他端口...`);
        try {
          const newPort = await findAvailablePort(actualPort + 1, 10);
          httpServer.close();
          proxyApp.listen(newPort, '127.0.0.1', () => {
            console.error(`HTTP Proxy Server started on port ${newPort}`);
            console.error(`Mock rules path: ${config.rulesPath}`);
            console.error(`请更新 Charles 配置或 mockServe/miMockServerConfig.json 中的端口号为 ${newPort}`);
          });
        } catch (err) {
          console.error('HTTP 代理无法启动（端口不可用），MCP 工具仍可用:', err);
        }
      }
    } else {
      console.error('HTTP 代理启动失败（MCP 工具仍可用）:', error.message);
    }
  });

  // 使用 stdio 传输（MCP 标准）
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('MCP Mock Server started');

  // 优雅关闭
  const shutdown = () => {
    console.error('Shutting down...');
    try {
      const rulesManager = getRulesManager();
      if (rulesManager && typeof (rulesManager as any).destroy === 'function') {
        (rulesManager as any).destroy();
      }
    } catch (error) {
      // 忽略清理错误
    }
    if (httpServer.listening) {
      httpServer.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
}

// 运行服务器
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
