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
 * 获取项目根目录
 * 优先使用 process.cwd()（Cursor 打开的项目目录）
 * 如果 process.cwd() 不存在或无效，则使用 MCP 服务本身的目录
 * 如果当前目录是 mockServe 子目录，继续向上查找真正的项目根目录
 */
function findProjectRoot(): string {
  // 优先使用 process.cwd()，这通常是 Cursor 打开的项目目录
  const cwd = process.cwd();
  
  // 检查 cwd 是否有效（存在且可访问）
  if (cwd && existsSync(cwd)) {
    // 检查当前目录是否是 mockServe 子目录
    const currentDirName = cwd.split(/[/\\]/).pop() || '';
    const isMockServeDir = currentDirName === 'mockServe' || cwd.endsWith('/mockServe') || cwd.endsWith('\\mockServe');
    
    if (isMockServeDir) {
      // 当前目录是 mockServe，继续向上查找项目根目录
      const parentDir = dirname(cwd);
      if (existsSync(parentDir)) {
        const parentPackageJsonPath = join(parentDir, 'package.json');
        if (existsSync(parentPackageJsonPath)) {
          // 父目录有 package.json，说明父目录是项目根目录
          return parentDir;
        }
      }
    }
    
    // 检查当前目录的父目录是否包含 mockServe 子目录
    // 如果包含，说明父目录是项目根目录
    const parentDir = dirname(cwd);
    if (existsSync(parentDir)) {
      const mockServeDir = join(parentDir, 'mockServe');
      if (existsSync(mockServeDir)) {
        const parentPackageJsonPath = join(parentDir, 'package.json');
        if (existsSync(parentPackageJsonPath)) {
          // 父目录包含 mockServe 子目录且有 package.json，说明父目录是项目根目录
          return parentDir;
        }
      }
    }
    
    // 尝试在 cwd 中查找 package.json，确认这是一个项目目录
    const packageJsonPath = join(cwd, 'package.json');
    if (existsSync(packageJsonPath)) {
      return cwd;
    }
    // 即使没有 package.json，也使用 cwd（可能是其他类型的项目）
    return cwd;
  }
  
  // 如果 cwd 无效，回退到 MCP 服务本身的目录
  let currentDir = __dirname;
  const root = resolve('/');
  
  while (currentDir !== root) {
    // 检查当前目录是否是 mockServe 子目录
    const currentDirName = currentDir.split(/[/\\]/).pop() || '';
    const isMockServeDir = currentDirName === 'mockServe' || currentDir.endsWith('/mockServe') || currentDir.endsWith('\\mockServe');
    
    if (isMockServeDir) {
      // 当前目录是 mockServe，继续向上查找
      currentDir = dirname(currentDir);
      continue;
    }
    
    // 检查当前目录的父目录是否包含 mockServe 子目录
    const parentDir = dirname(currentDir);
    if (existsSync(parentDir)) {
      const mockServeDir = join(parentDir, 'mockServe');
      if (existsSync(mockServeDir)) {
        const parentPackageJsonPath = join(parentDir, 'package.json');
        if (existsSync(parentPackageJsonPath)) {
          // 父目录包含 mockServe 子目录且有 package.json，说明父目录是项目根目录
          return parentDir;
        }
      }
    }
    
    const packageJsonPath = join(currentDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }
  
  // 最后的回退
  return cwd || currentDir;
}

// 不在模块加载时计算 PROJECT_ROOT，而是在需要时动态获取
// const PROJECT_ROOT = findProjectRoot();

/**
 * 获取项目根目录（动态获取，确保使用当前工作目录）
 */
function getProjectRootDynamic(): string {
  return findProjectRoot();
}

/**
 * 默认配置（使用动态获取的项目根目录）
 */
function getDefaultConfig(): ServerConfig {
  const projectRoot = getProjectRootDynamic();
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
  const projectRoot = getProjectRootDynamic();
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
 * 导出项目根目录（供其他模块使用，动态获取）
 */
export function getProjectRoot(): string {
  return getProjectRootDynamic();
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
