#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createProxyServer } from './proxy.js';
import { fileURLToPath } from 'url';
import { 
  getConfig, 
  findAvailablePort,
  setClientProjectRoot,
  setActualProxyPort,
  getActualProxyPort,
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
import { getRulesManager, reloadRules } from './rules.js';

/**
 * 启动 MCP Mock Server
 */
async function main() {
  const config = getConfig();

  // 初始化 MCP 服务器
  const server = new Server(
    {
      name: 'mockserver-mcp-charles',
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

  // 客户端初始化完成后，从 MCP 客户端（如 Cursor）获取工作区根目录，用于准确解析项目路径
  server.oninitialized = async () => {
    try {
      const result = await server.listRoots();
      if (result?.roots?.length) {
        const first = result.roots[0];
        if (first?.uri?.startsWith('file:')) {
          const projectPath = fileURLToPath(first.uri);
          setClientProjectRoot(projectPath);
          console.error(`[mockserver-mcp-charles] 已使用 MCP 客户端工作区根目录: ${projectPath}`);
        }
      }
    } catch (err) {
      // 客户端可能不支持 roots（如部分旧版 Cursor），回退到默认推断的 workspace 根目录
      console.error('[mockserver-mcp-charles] 未从客户端获取 roots，使用默认项目根推断:', err instanceof Error ? err.message : String(err));
    }
  };

  // 注册工具调用处理器
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = args || {};

    // 若大模型在调用 tool 时传入了「用户代码的工作区目录」，则设为项目根并重载规则，使代理读取数据也使用该项目
    if (safeArgs.workspaceRoot && typeof safeArgs.workspaceRoot === 'string' && safeArgs.workspaceRoot.trim()) {
      setClientProjectRoot(safeArgs.workspaceRoot.trim());
      reloadRules(); // 使 RulesManager 从新项目根重新加载 rules.json，接口（代理）后续读取的即是该项目
    }

    const handler = toolHandlers[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      const result = await handler(safeArgs);
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
  // 直接从配置端口开始寻找可用端口，不杀已有进程（支持同一台机器多个项目同时运行各自的 MCP）
  const proxyApp = createProxyServer();
  let actualPort: number | null = null;
  try {
    actualPort = await findAvailablePort(config.port, 50);
  } catch {
    console.error(`[mockserver] 无法找到可用端口（${config.port}~${config.port + 49} 均已占用），HTTP 代理将不启动，MCP 工具仍可用`);
  }

  // 绑定 127.0.0.1 而非 0.0.0.0，避免部分环境 EPERM（如 Cursor 启动 MCP 时）
  const httpServer = actualPort !== null
    ? proxyApp.listen(actualPort, '127.0.0.1', () => {
        setActualProxyPort(actualPort!);
        console.error(`[mockserver] HTTP 代理已启动`);
        console.error(`[mockserver] 代理地址: http://127.0.0.1:${actualPort}`);
        console.error(`[mockserver] 规则目录: ${config.rulesPath}`);
        if (actualPort !== config.port) {
          console.error(`[mockserver] 配置端口 ${config.port} 已被占用，自动切换至 ${actualPort}`);
          console.error(`[mockserver] 请在 miMockServerConfig.json 中将 port 改为 ${actualPort}，或重新生成 Charles 映射`);
        }
      })
    : null;

  // 处理监听错误：EPERM/EACCES/EADDRINUSE 时不退出进程，MCP 工具仍可用
  httpServer?.on('error', (error: any) => {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      console.error(`[mockserver] HTTP 代理无法绑定端口（无权限），MCP 工具仍可用: ${error.message}`);
    } else if (error.code === 'EADDRINUSE') {
      console.error(`[mockserver] HTTP 代理端口 ${actualPort} 已被占用，MCP 工具仍可用`);
    } else {
      console.error(`[mockserver] HTTP 代理启动失败（MCP 工具仍可用）: ${error.message}`);
    }
  });

  // 使用 stdio 传输（MCP 标准）
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[mockserver] MCP Server 已就绪');

  let isShuttingDown = false;

  // 优雅关闭
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.error('[mockserver] 正在关闭...');
    try {
      const rulesManager = getRulesManager();
      if (rulesManager && typeof (rulesManager as any).destroy === 'function') {
        (rulesManager as any).destroy();
      }
    } catch {
      // 忽略清理错误
    }
    const forceExitTimer = setTimeout(() => process.exit(0), 3000);
    forceExitTimer.unref?.();
    if (httpServer?.listening) {
      httpServer.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  };

  // 当 Cursor 关闭/编辑器关闭时，stdin/stdout 管道会断开，此时主动退出代理
  // 同时监听 stdin 和 stdout 的关闭事件，任意一个触发即关闭（双重保险）
  process.stdin.on('close', shutdown);
  process.stdin.on('end', shutdown);
  process.stdout.on('close', shutdown);

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
