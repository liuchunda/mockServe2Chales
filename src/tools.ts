import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getRulesManager, reloadRules } from './rules.js';
import { getRequestLogManager } from './proxy.js';
import { getConfig, getEffectiveProxyPortForCharles } from './config.js';
import { writeFileSync } from 'fs';
import { generateCharlesXMLConfigFile } from './charles.js';

const rulesManager = getRulesManager();

/** 所有工具共有的可选参数：由大模型传入用户工作区目录，用于准确解析项目根 */
const WORKSPACE_ROOT_PARAM = {
  workspaceRoot: {
    type: 'string' as const,
    description: '用户代码的工作区目录（当前 Cursor 打开的项目根路径）。',
  },
};

/**
 * 添加 Mock 规则工具
 */
export const addMockRuleTool: Tool = {
  name: 'add_mock_rule',
  description: '添加一个新的 Mock 规则，帮我Mock一个接口，当用户说「mock接口」「mock一个接口」「添加mock规则」「mock一个API接口」时，应调用此 MCP 工具。在 Cursor 中输入接口路径和 JSON 数据即可创建 Mock 接口。',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '接口路径，例如 /api/user/info',
      },
      method: {
        type: 'string',
        description: 'HTTP 方法（GET、POST、PUT、DELETE 等），默认为 GET',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
        default: 'GET',
      },
      response: {
        type: 'object',
        description: 'JSON 格式的响应数据。若含深层嵌套，建议以 JSON 字符串传入，避免被序列化为 [Object]。',
      },
      statusCode: {
        type: 'number',
        description: 'HTTP 状态码，默认为 200',
        default: 200,
      },
      headers: {
        type: 'object',
        description: '自定义响应头（可选）',
        additionalProperties: {
          type: 'string',
        },
      },
      delay: {
        type: 'number',
        description: '响应延迟（毫秒），可选',
      },
      ...WORKSPACE_ROOT_PARAM,
    },
    required: ['url', 'response'],
  },
};

/**
 * 删除 Mock 规则工具
 */
export const removeMockRuleTool: Tool = {
  name: 'remove_mock_rule',
  description: '删除一个 Mock 规则。可以通过规则 ID 或 URL 和方法来删除。',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: '规则 ID（如果提供，将优先使用）',
      },
      url: {
        type: 'string',
        description: '接口路径',
      },
      method: {
        type: 'string',
        description: 'HTTP 方法',
        enum: ['POST', 'GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
      },
      ...WORKSPACE_ROOT_PARAM,
    },
    required: [],
  },
};

/**
 * 列出所有 Mock 规则工具
 */
export const listMockRulesTool: Tool = {
  name: 'list_mock_rules',
  description: '列出所有已配置的 Mock 规则',
  inputSchema: {
    type: 'object',
    properties: { ...WORKSPACE_ROOT_PARAM },
  },
};

/**
 * 启用/禁用 Mock 功能工具
 */
export const toggleMockTool: Tool = {
  name: 'toggle_mock',
  description: '启用或禁用全局 Mock 功能',
  inputSchema: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        description: '是否启用 Mock 功能',
      },
      ...WORKSPACE_ROOT_PARAM,
    },
    required: ['enabled'],
  },
};

/**
 * 获取请求日志工具
 */
export const getRequestLogsTool: Tool = {
  name: 'get_request_logs',
  description: '获取请求日志，用于调试和问题排查',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: '返回的日志条数，默认为 100',
        default: 100,
      },
      ...WORKSPACE_ROOT_PARAM,
    },
  },
};

/**
 * 生成 Charles 配置工具
 * 描述中明确包含用户常见说法，便于 Cursor 在用户说「生成 Charles 映射文件」时匹配并调用。
 */
export const generateCharlesConfigTool: Tool = {
  name: 'generate_charles_config',
  description: '生成 Charles 映射文件（Charles Map Remote 配置，输出 map-remote.xml）。当用户说「生成Charles Map Remote」「帮我重新生成映射文件」「帮我生成映射文件」「生成 Charles 映射文件」「生成映射文件」「Charles 映射文件」「更新映射文件配置」「导出 Charles 配置」时，应调用此 MCP 工具。域名与端口可从项目根 miMockServerConfig.json 的 charlesTargetDomains、charlesTargetPort 读取，也可通过参数传入。',
  inputSchema: {
    type: 'object',
    properties: {
      targetDomain: {
        type: 'string',
        description: '目标 API 域名（可选，不传则从项目根 miMockServerConfig.json 的 charlesTargetDomains 读取）',
      },
      targetDomains: {
        type: 'array',
        items: { type: 'string' },
        description: '多个目标域名（可选），不传则从配置文件读取',
      },
      targetPort: {
        type: 'number',
        description: '目标 API 端口（可选），默认从配置或 443',
      },
      ...WORKSPACE_ROOT_PARAM,
    },
    required: [],
  },
};

/**
 * 重新加载规则工具
 */
export const reloadRulesTool: Tool = {
  name: 'reload_rules',
  description: '重新从文件加载 Mock 规则（当手动修改 rules.json 文件后使用）',
  inputSchema: {
    type: 'object',
    properties: { ...WORKSPACE_ROOT_PARAM },
  },
};

/**
 * 工具处理器映射
 */
export const toolHandlers: Record<string, (args: any) => Promise<any>> = {
  add_mock_rule: async (args: any) => {
    // 确保规则写入项目中的 _mock-rules/rules.json（与 miMockServerConfig.json 的 rulesPath 一致）
    if (getConfig().rulesPath !== rulesManager.getRulesPath()) {
      reloadRules();
    }

    const {
      url,
      method = 'GET',
      response,
      statusCode = 200,
      headers,
      delay,
    } = args;

    if (!url || response === undefined || response === null) {
      throw new Error('url 和 response 是必需的参数');
    }

    // 规范化 response：支持传入 JSON 字符串，并深拷贝为纯对象，避免嵌套字段（如 chatRecordlist）被序列化成 [Object]
    let responseObj: any;
    if (typeof response === 'string') {
      try {
        responseObj = JSON.parse(response);
      } catch {
        throw new Error('response 为字符串时必须是合法 JSON');
      }
    } else {
      responseObj = response;
    }
    responseObj = JSON.parse(JSON.stringify(responseObj));

    const methodUpper = method.toUpperCase();
    const existed = rulesManager.getRuleByUrlAndMethod(url, methodUpper);
    const rule = rulesManager.addOrUpdateRule({
      url,
      method: methodUpper,
      response: responseObj,
      statusCode,
      headers,
      delay,
      enabled: true,
    });

    // 注意：Charles 配置需要目标域名，不会自动生成
    // 用户需要使用 generate_charles_config 工具手动生成
    return {
      success: true,
      message: existed ? `Mock 规则已更新（同接口覆盖）：${methodUpper} ${url}` : `Mock 规则已添加：${methodUpper} ${url}`,
      rule: {
        id: rule.id,
        url: rule.url,
        method: rule.method,
        statusCode: rule.statusCode,
        enabled: rule.enabled,
      },
      charlesConfigHint: {
        message: '要生成 Charles 配置文件，请使用 generate_charles_config 工具，并指定 targetDomain 参数',
        example: {
          tool: 'generate_charles_config',
          args: {
            targetDomain: 'api.example.com',
            targetProtocol: 'https',
            targetPort: 443,
          },
        },
      },
    };
  },

  remove_mock_rule: async (args: any) => {
    // 确保操作的是项目中的 _mock-rules/rules.json
    if (getConfig().rulesPath !== rulesManager.getRulesPath()) {
      reloadRules();
    }

    const { id, url, method } = args;

    if (id) {
      const removed = rulesManager.removeRule(id);
      if (removed) {
        return {
          success: true,
          message: `Mock 规则已删除：ID ${id}`,
        };
      } else {
        return {
          success: false,
          message: `未找到 ID 为 ${id} 的规则`,
        };
      }
    } else if (url && method) {
      const removed = rulesManager.removeRuleByUrlAndMethod(url, method);
      if (removed) {
        return {
          success: true,
          message: `Mock 规则已删除：${method} ${url}`,
        };
      } else {
        return {
          success: false,
          message: `未找到规则：${method} ${url}`,
        };
      }
    } else {
      throw new Error('必须提供 id 或 (url 和 method)');
    }
  },

  list_mock_rules: async () => {
    const rules = rulesManager.getAllRules();
    return {
      success: true,
      count: rules.length,
      rules: rules.map(rule => ({
        id: rule.id,
        url: rule.url,
        method: rule.method,
        statusCode: rule.statusCode,
        enabled: rule.enabled,
        createdAt: rule.createdAt,
      })),
    };
  },

  toggle_mock: async (args: any) => {
    const { enabled } = args;
    const config = getConfig();

    // 更新配置（这里简化处理，实际应该持久化配置）
    (config as any).mockEnabled = enabled;

    // 可以保存到配置文件
    try {
      const { getWorkspaceRoot } = await import('./config.js');
      const { join } = await import('path');
      const projectRoot = getWorkspaceRoot();
      const configPath = join(projectRoot, 'miMockServerConfig.json');
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      console.warn('Failed to save config:', error);
    }

    return {
      success: true,
      message: `Mock 功能已${enabled ? '启用' : '禁用'}`,
      mockEnabled: enabled,
    };
  },

  get_request_logs: async (args: any) => {
    const { limit = 100 } = args || {};
    const logManager = getRequestLogManager();
    const logs = logManager.getLogs(limit);

    return {
      success: true,
      count: logs.length,
      logs: logs.map(log => ({
        id: log.id,
        timestamp: log.timestamp,
        method: log.method,
        url: log.url,
        statusCode: log.statusCode,
        isMocked: log.isMocked,
        duration: log.duration,
      })),
    };
  },

  generate_charles_config: async (args: any) => {
    const config = getConfig() as any;
    const { targetDomain, targetDomains, targetPort } = args || {};
    // 优先使用调用参数，否则使用项目根 miMockServerConfig.json 中的配置（mockServe 内无预设）
    const domainsFromArgs = targetDomains ?? (targetDomain ? [targetDomain] : null);
    const domainsFromConfig = config.charlesTargetDomains ?? (config.charlesTargetDomain ? [config.charlesTargetDomain] : []);
    const domains = domainsFromArgs ?? (domainsFromConfig.length > 0 ? domainsFromConfig : null);
    const port = targetPort ?? config.charlesTargetPort ?? 443;

    if (!domains || (Array.isArray(domains) && domains.length === 0)) {
      throw new Error(
        '未读取到 Charles 域名配置。请在项目根目录的 miMockServerConfig.json 中配置 charlesTargetDomains（数组）和 charlesTargetPort（可选，默认 443），或调用时传入 targetDomains / targetDomain 和 targetPort。'
      );
    }

    const rules = rulesManager.getAllRules();
    const { dirname } = await import('path');
    const rulesDir = dirname(config.rulesPath);
    // 以当前实际启动的代理端口为准：内存 → 项目内 .actual-proxy-port 文件 → 配置端口
    const workspaceRootForPort = (args?.workspaceRoot && typeof args.workspaceRoot === 'string') ? args.workspaceRoot.trim() : undefined;
    const mockServerPort = getEffectiveProxyPortForCharles(workspaceRootForPort);
    const xmlPath = generateCharlesXMLConfigFile(rules, mockServerPort, domains, port, rulesDir);
    return {
      success: true,
      message: `Charles 配置文件已生成（${Array.isArray(domains) ? domains.length : 1} 个域名，同时支持 http 和 https）`,
      files: { xml: xmlPath },
      config: {
        targetDomains: Array.isArray(domains) ? domains : [domains],
        targetPort: port,
        mockServerPort,
        rulesCount: rules.length,
      },
      importSteps: [
        '1. 打开 Charles',
        '2. 菜单：Tools -> Map Remote...',
        '3. 点击 "Import Settings" 按钮',
        '4. 选择生成的 XML 配置文件',
        '5. 确认导入后，规则会自动生效',
      ],
    };
  },

  reload_rules: async () => {
    try {
      reloadRules();
      const rules = rulesManager.getAllRules();
      return {
        success: true,
        message: '规则已重新加载',
        rulesCount: rules.length,
        rulesPath: getConfig().rulesPath,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '重新加载规则失败',
      };
    }
  },
};
