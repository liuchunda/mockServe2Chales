import { ServerConfig } from './types.js';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'net';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 工作区根目录：仅由 MCP Roots（listRoots）或 tool 参数 workspaceRoot（WORKSPACE_ROOT_PARAM）设置。
 * 未设置时用 process.cwd() 作为最小回退，保证服务能启动。
 */
let clientProjectRoot: string | null = null;

/**
 * 设置工作区根目录（来自 MCP roots/list 或 tool 参数 workspaceRoot）。
 */
export function setClientProjectRoot(path: string | null): void {
  clientProjectRoot = path ? (path.trim() || null) : null;
}

/**
 * 获取工作区根目录。仅使用已设置的 clientProjectRoot（WORKSPACE_ROOT_PARAM / Roots），未设置时回退 process.cwd()。
 */
function getWorkspaceRootInternal(): string {
  if (clientProjectRoot && existsSync(clientProjectRoot)) {
    return clientProjectRoot;
  }
  return process.cwd();
}

/**
 * 默认配置（使用工作区根目录，由 WORKSPACE_ROOT_PARAM / Roots 设置）
 */
function getDefaultConfig(): ServerConfig {
  const projectRoot = getWorkspaceRootInternal();
  return {
    port: 7979, // 使用不常用的端口，避免与其他服务冲突
    rulesPath: join(projectRoot, '_mock-rules', 'rules.json'),
    enableLogging: true,
    maxLogs: 1000,
    mockEnabled: true,
  };
}

/**
 * 扩展配置类型（包含 Charles 相关配置）
 */
export interface ExtendedConfig extends ServerConfig {
  /** 单个域名（兼容旧配置） */
  charlesTargetDomain?: string;
  /** 多环境域名数组：线上、预发、测试等，生成 Charles 时为每个域名精准映射 */
  charlesTargetDomains?: string[];
  charlesTargetPort?: number;
}

/**
 * 获取 mockServe 包所在目录（MCP 代码所在包的根目录）
 * 用于在 process.cwd() 与预期不符时仍能读取包内的 miMockServerConfig.json
 */
function getMockServeRoot(): string {
  return resolve(__dirname, '..');
}

/**
 * 加载配置
 * 配置文件查找顺序：项目根 miMockServerConfig.json → 项目根 config.json → mockServe 包根 miMockServerConfig.json
 * 这样在 MCP 运行时 cwd 不是工作区根目录时，仍能读到包内的配置文件
 */
export function loadConfig(): ServerConfig {
  const projectRoot = getWorkspaceRootInternal();
  const mockServeRoot = getMockServeRoot();
  const defaultConfig = getDefaultConfig();

  // 按优先级确定要读取的配置文件路径
  const projectConfigPathNew = join(projectRoot, 'miMockServerConfig.json');
  const projectConfigPathOld = join(projectRoot, 'config.json');
  const mockServeConfigPath = join(mockServeRoot, 'miMockServerConfig.json');

  let configPath: string | null = null;
  if (existsSync(projectConfigPathNew)) {
    configPath = projectConfigPathNew;
  } else if (existsSync(projectConfigPathOld)) {
    configPath = projectConfigPathOld;
  } else if (existsSync(mockServeConfigPath)) {
    configPath = mockServeConfigPath;
  }

  // 端口仅从 mockServe 包内 miMockServerConfig.json 读取（若存在）
  let portFromMockServe = defaultConfig.port;
  if (existsSync(mockServeConfigPath)) {
    try {
      const mockServeConfigContent = readFileSync(mockServeConfigPath, 'utf-8');
      const mockServeConfig = JSON.parse(mockServeConfigContent);
      if (mockServeConfig.port != null) {
        portFromMockServe = mockServeConfig.port;
      }
    } catch {
      // 忽略错误，使用默认端口
    }
  }

  if (configPath) {
    try {
      const configContent = readFileSync(configPath, 'utf-8');
      const userConfig = JSON.parse(configContent);
      const { port: _, ...userConfigWithoutPort } = userConfig;
      const mergedConfig = { ...defaultConfig, ...userConfigWithoutPort, port: portFromMockServe };
      // 相对路径基于「当前使用的配置文件所在目录」解析，避免 cwd 不对时路径错误
      const configBaseDir = dirname(configPath);
      if (userConfig.rulesPath) {
        mergedConfig.rulesPath = userConfig.rulesPath.startsWith('/')
          ? userConfig.rulesPath
          : join(configBaseDir, userConfig.rulesPath);
      } else {
        mergedConfig.rulesPath = join(configBaseDir, '_mock-rules', 'rules.json');
      }
      return mergedConfig;
    } catch (error) {
      console.warn(`Failed to load ${configPath}, using default config:`, error);
    }
  }

  return { ...defaultConfig, port: portFromMockServe };
}

/**
 * 确保规则目录存在
 */
export function ensureRulesDirectory(rulesPath: string): void {
  const rulesDir = dirname(rulesPath);
  if (!existsSync(rulesDir)) {
    mkdirSync(rulesDir, { recursive: true });
  }
}

/**
 * 检查端口是否可用
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    
    server.listen(port, () => {
      server.once('close', () => resolve(true));
      server.close();
    });
    
    server.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * 查找可用端口
 */
export async function findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  throw new Error(`无法找到可用端口，已尝试 ${maxAttempts} 个端口（从 ${startPort} 开始）`);
}

/**
 * 获取配置实例（每次调用时重新加载，确保使用最新的项目根目录）
 */
export function getConfig(): ServerConfig {
  // 每次都重新加载配置，确保使用最新的 process.cwd()
  const config = loadConfig();
  ensureRulesDirectory(config.rulesPath);
  return config;
}

/**
 * 获取工作区根目录（供其他模块使用）。
 * 仅由 MCP Roots 或 tool 参数 workspaceRoot（WORKSPACE_ROOT_PARAM）设置，未设置时回退 process.cwd()。
 */
export function getWorkspaceRoot(): string {
  return getWorkspaceRootInternal();
}

/**
 * 获取占用端口的进程 PID
 */
export async function getProcessIdByPort(port: number): Promise<number | null> {
  const platform = process.platform;
  
  try {
    if (platform === 'darwin' || platform === 'linux') {
      // macOS 和 Linux 使用 lsof
      const { stdout } = await execAsync(`lsof -ti:${port}`);
      const pid = parseInt(stdout.trim(), 10);
      return isNaN(pid) ? null : pid;
    } else if (platform === 'win32') {
      // Windows 使用 netstat
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const lines = stdout.split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length > 0) {
          const pid = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(pid)) {
            return pid;
          }
        }
      }
      return null;
    }
  } catch (error) {
    // 命令执行失败，可能端口没有被占用
    return null;
  }
  
  return null;
}

/**
 * 关闭占用端口的进程
 */
export async function killProcessByPort(port: number): Promise<boolean> {
  const pid = await getProcessIdByPort(port);

  if (!pid) {
    return false;
  }

  try {
    const platform = process.platform;
    if (platform === 'darwin' || platform === 'linux') {
      await execAsync(`kill -9 ${pid}`);
      console.error(`已关闭占用端口 ${port} 的进程 (PID: ${pid})`);
      return true;
    } else if (platform === 'win32') {
      await execAsync(`taskkill /F /PID ${pid}`);
      console.error(`已关闭占用端口 ${port} 的进程 (PID: ${pid})`);
      return true;
    }
  } catch (error) {
    console.error(`关闭进程失败 (PID: ${pid}):`, error);
    return false;
  }
  
  return false;
}
