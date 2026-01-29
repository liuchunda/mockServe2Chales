/**
 * Mock 规则数据结构
 */
export interface MockRule {
  /** 规则唯一标识 */
  id: string;
  /** 接口路径，支持通配符 */
  url: string;
  /** HTTP 方法 */
  method: string;
  /** 响应数据 */
  response: any;
  /** HTTP 状态码 */
  statusCode: number;
  /** 自定义响应头 */
  headers?: Record<string, string>;
  /** 响应延迟（毫秒） */
  delay?: number;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt?: string;
}

/**
 * Mock 规则集合
 */
export interface MockRulesData {
  /** 规则列表 */
  rules: MockRule[];
  /** 版本号 */
  version: string;
}

/**
 * 请求日志
 */
export interface RequestLog {
  /** 日志 ID */
  id: string;
  /** 请求时间 */
  timestamp: string;
  /** 请求方法 */
  method: string;
  /** 请求 URL */
  url: string;
  /** 请求头 */
  headers: Record<string, string>;
  /** 请求体 */
  body?: any;
  /** 响应状态码 */
  statusCode?: number;
  /** 响应数据 */
  response?: any;
  /** 是否使用了 Mock */
  isMocked: boolean;
  /** 响应时间（毫秒） */
  duration?: number;
}

/**
 * 服务器配置
 */
export interface ServerConfig {
  /** HTTP 代理服务器端口 */
  port: number;
  /** Mock 规则存储路径 */
  rulesPath: string;
  /** 是否启用日志 */
  enableLogging: boolean;
  /** 日志最大条数 */
  maxLogs: number;
  /** 是否启用 Mock（全局开关） */
  mockEnabled: boolean;
}

/**
 * 规则匹配结果
 */
export interface RuleMatchResult {
  /** 是否匹配 */
  matched: boolean;
  /** 匹配的规则 */
  rule?: MockRule;
}
