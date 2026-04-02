import { ServerConfig } from './types.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
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
 * 用于在 process.cwd() 与预期不符时仍能读取包内的 mockCharlesConfig.json
 */
function getMockServeRoot(): string {
  return resolve(__dirname, '..');
}

/**
 * 加载配置
 * 配置文件查找顺序：项目根 mockCharlesConfig.json → 项目根 config.json → mockServe 包根 mockCharlesConfig.json
 * 这样在 MCP 运行时 cwd 不是工作区根目录时，仍能读到包内的配置文件
 */
export function loadConfig(): ServerConfig {
  const projectRoot = getWorkspaceRootInternal();
  const mockServeRoot = getMockServeRoot();
  const defaultConfig = getDefaultConfig();

  // 按优先级确定要读取的配置文件路径
  const projectConfigPathNew = join(projectRoot, 'mockCharlesConfig.json');
  const projectConfigPathScripts = join(projectRoot, 'scripts', 'mockCharlesConfig.json');
  const projectConfigPathOld = join(projectRoot, 'config.json');
  const mockServeConfigPath = join(mockServeRoot, 'mockCharlesConfig.json');

  let configPath: string | null = null;
  if (existsSync(projectConfigPathNew)) {
    configPath = projectConfigPathNew;
  } else if (existsSync(projectConfigPathScripts)) {
    configPath = projectConfigPathScripts;
  } else if (existsSync(projectConfigPathOld)) {
    configPath = projectConfigPathOld;
  } else if (existsSync(mockServeConfigPath)) {
    configPath = mockServeConfigPath;
  }

  // 端口仅从 mockServe 包内 mockCharlesConfig.json 读取（若存在）
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
      // rulesPath 始终基于项目根目录解析，避免配置文件放在 scripts/ 等子目录时路径偏移
      if (userConfig.rulesPath) {
        mergedConfig.rulesPath = userConfig.rulesPath.startsWith('/')
          ? userConfig.rulesPath
          : join(projectRoot, userConfig.rulesPath);
      } else {
        mergedConfig.rulesPath = join(projectRoot, '_mock-rules', 'rules.json');
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
 * 检查端口是否可用（在 127.0.0.1 上检测，与实际绑定地址一致，避免 0.0.0.0 vs 127.0.0.1 的误判）
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.listen(port, '127.0.0.1', () => {
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
 * 注意：不再在此处自动创建目录，目录仅在真正写入文件时按需创建
 */
export function getConfig(): ServerConfig {
  return loadConfig();
}

/**
 * 检查用户项目根目录下是否存在 mockCharlesConfig.json 配置文件。
 * 若不存在，返回包含错误信息和配置模版的提示字符串；存在则返回 null。
 */
export function checkProjectConfig(): string | null {
  const projectRoot = getWorkspaceRootInternal();
  const configPathRoot = join(projectRoot, 'mockCharlesConfig.json');
  const configPathScripts = join(projectRoot, 'scripts', 'mockCharlesConfig.json');
  if (!existsSync(configPathRoot) && !existsSync(configPathScripts)) {
    const template = JSON.stringify(
      {
        charlesTargetDomains: ['api.example.com'],
        charlesTargetPort: 443,
      },
      null,
      2
    );
    return (
      `未在项目根目录（${projectRoot}）或 scripts/ 目录下找到 mockCharlesConfig.json 配置文件。\n\n` +
      `请在项目根目录创建 mockCharlesConfig.json，内容模版如下：\n\n` +
      `\`\`\`json\n${template}\n\`\`\`\n\n` +
      `字段说明：\n` +
      `  - charlesTargetDomains：需要代理的 API 域名列表（必填）\n` +
      `  - charlesTargetPort：目标 API 端口，默认 443（可选）`
    );
  }
  return null;
}

/**
 * 获取工作区根目录（供其他模块使用）。
 * 仅由 MCP Roots 或 tool 参数 workspaceRoot（WORKSPACE_ROOT_PARAM）设置，未设置时回退 process.cwd()。
 */
export function getWorkspaceRoot(): string {
  return getWorkspaceRootInternal();
}

/**
 * 当前进程实际绑定的 HTTP 代理端口（运行时状态，非配置值）。
 * 由 server.ts 在 listen 成功后写入，供 tools/rules 生成 Charles 配置时使用。
 */
let _actualProxyPort: number | null = null;

export function setActualProxyPort(port: number): void {
  _actualProxyPort = port;
}

/** 返回当前进程实际监听的代理端口，未启动时返回 null */
export function getActualProxyPort(): number | null {
  return _actualProxyPort;
}

const ACTUAL_PROXY_PORT_FILENAME = '.actual-proxy-port';

/**
 * 获取「实际代理端口」状态文件路径（位于项目 _mock-rules 目录下）
 */
function getActualProxyPortFilePath(rulesPath: string): string {
  return join(dirname(rulesPath), ACTUAL_PROXY_PORT_FILENAME);
}

/**
 * 将当前实际代理端口写入项目 _mock-rules 目录，供生成 Charles 配置时读取（含跨进程场景）。
 * 若目录尚未创建（用户还未使用任何 tool），写入会静默失败，不产生副作用。
 */
export function writeActualProxyPortFile(port: number): void {
  const config = loadConfig();
  const filePath = getActualProxyPortFilePath(config.rulesPath);
  try {
    writeFileSync(filePath, String(port), 'utf-8');
  } catch {
    // 目录不存在或无写入权限时静默忽略，_actualProxyPort 内存值仍可用
  }
}

/**
 * 从项目 _mock-rules 目录读取已保存的实际代理端口（用于生成 Charles 时与当前进程不一致的情况）
 * @param workspaceRoot 工作区根目录，不传则用 getWorkspaceRoot()
 */
export function readActualProxyPortFromFile(workspaceRoot?: string): number | null {
  const root = workspaceRoot ?? getWorkspaceRootInternal();
  const filePath = join(root, '_mock-rules', ACTUAL_PROXY_PORT_FILENAME);
  if (!existsSync(filePath)) return null;
  try {
    const s = readFileSync(filePath, 'utf-8').trim();
    const port = parseInt(s, 10);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

/**
 * 生成 Charles 映射时使用的「有效代理端口」：当前进程实际端口 → 项目内保存的端口文件 → 配置端口 → 7979
 */
export function getEffectiveProxyPortForCharles(workspaceRoot?: string): number {
  const inProcess = getActualProxyPort();
  if (inProcess != null) return inProcess;
  const fromFile = readActualProxyPortFromFile(workspaceRoot ?? getWorkspaceRootInternal());
  if (fromFile != null) return fromFile;
  const config = loadConfig();
  return config.port ?? 7979;
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
