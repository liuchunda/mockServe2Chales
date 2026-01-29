import express, { Request, Response, NextFunction } from 'express';
import { getRulesManager } from './rules.js';
import { getConfig } from './config.js';
import { RequestLog } from './types.js';
import { randomUUID } from 'crypto';

/**
 * 请求日志管理器
 */
class RequestLogManager {
  private logs: RequestLog[] = [];
  private maxLogs: number;

  constructor(maxLogs: number = 1000) {
    this.maxLogs = maxLogs;
  }

  /**
   * 添加日志
   */
  addLog(log: RequestLog): void {
    this.logs.push(log);
    
    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  /**
   * 获取所有日志
   */
  getLogs(limit?: number): RequestLog[] {
    if (limit) {
      return this.logs.slice(-limit);
    }
    return [...this.logs];
  }

  /**
   * 清空日志
   */
  clearLogs(): void {
    this.logs = [];
  }
}

// 单例实例
let logManagerInstance: RequestLogManager | null = null;

function getLogManager(): RequestLogManager {
  if (!logManagerInstance) {
    const config = getConfig();
    logManagerInstance = new RequestLogManager(config.maxLogs);
  }
  return logManagerInstance;
}

/**
 * 创建代理服务器
 */
export function createProxyServer() {
  const app = express();
  const config = getConfig();
  const rulesManager = getRulesManager();
  const logManager = getLogManager();

  // 解析 JSON 请求体
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 请求日志中间件
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const logId = randomUUID();

    // 记录请求信息
    const requestLog: Partial<RequestLog> = {
      id: logId,
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: req.headers as Record<string, string>,
      body: req.body,
      isMocked: false,
    };

    // 拦截响应
    const originalSend = res.send;
    res.send = function (body: any) {
      const duration = Date.now() - startTime;
      
      requestLog.statusCode = res.statusCode;
      requestLog.response = body;
      requestLog.duration = duration;

      if (config.enableLogging) {
        logManager.addLog(requestLog as RequestLog);
      }

      return originalSend.call(this, body);
    };

    next();
  });

  // 处理所有请求
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    // 检查全局 Mock 开关
    if (!config.mockEnabled) {
      return next();
    }

    // 每次请求时重新获取规则管理器（确保使用最新实例）
    const currentRulesManager = getRulesManager();
    
    // 调试信息：记录请求路径和方法
    const allRules = currentRulesManager.getAllRules();
    console.error(`[Mock] Request: ${req.method} ${req.path}, Total rules: ${allRules.length}`);
    if (allRules.length > 0) {
      console.error(`[Mock] First rule: ${allRules[0].method} ${allRules[0].url}, enabled: ${allRules[0].enabled}`);
    }
    
    // 尝试匹配 Mock 规则
    const matchResult = currentRulesManager.matchRule(req.path, req.method);
    
    console.error(`[Mock] Match result: ${matchResult.matched ? 'MATCHED' : 'NOT MATCHED'}`);

    if (matchResult.matched && matchResult.rule) {
      const rule = matchResult.rule;
      
      // 标记为 Mock 响应
      (req as any).isMocked = true;

      // 设置响应头
      if (rule.headers) {
        Object.entries(rule.headers).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
      }

      // 设置状态码
      res.status(rule.statusCode);

      // 延迟响应（如果配置了）
      if (rule.delay && rule.delay > 0) {
        await new Promise(resolve => setTimeout(resolve, rule.delay));
      }

      // 返回 Mock 数据
      return res.json(rule.response);
    }

    // 没有匹配的规则，继续到下一个中间件（代理到真实 API）
    next();
  });

  // 处理没有 Mock 规则的情况
  app.use((req: Request, res: Response) => {
    // 如果没有匹配的 Mock 规则，返回友好的错误信息
    res.status(404).json({
      error: 'No mock rule found',
      message: `No mock rule found for ${req.method} ${req.path}`,
      hint: 'Use the add_mock_rule tool in Cursor to create a mock rule for this endpoint',
    });
  });

  return app;
}

/**
 * 获取请求日志管理器（用于 MCP 工具）
 */
export function getRequestLogManager(): RequestLogManager {
  return getLogManager();
}
