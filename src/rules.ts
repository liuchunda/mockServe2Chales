import { MockRule, MockRulesData, RuleMatchResult } from './types.js';
import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getConfig, ensureRulesDirectory } from './config.js';
import { randomUUID } from 'crypto';
import { generateCharlesXMLConfigFile } from './charles.js';

/**
 * 规则管理器
 */
export class RulesManager {
  private rules: Map<string, MockRule> = new Map();
  private rulesPath: string;
  private fileWatcher: any = null;
  private reloadTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.rulesPath = getConfig().rulesPath;
    this.loadRules();
    this.startFileWatcher();
  }

  /**
   * 启动文件监听
   */
  private startFileWatcher(): void {
    if (!existsSync(this.rulesPath)) {
      return;
    }

    // 使用 watchFile 监听文件变化（更可靠）
    this.fileWatcher = watchFile(this.rulesPath, { interval: 1000 }, (curr, prev) => {
      // 检查文件是否真的被修改了
      if (curr.mtimeMs !== prev.mtimeMs) {
        // 防抖：延迟 500ms 后重新加载，避免频繁触发
        if (this.reloadTimeout) {
          clearTimeout(this.reloadTimeout);
        }
        
        this.reloadTimeout = setTimeout(() => {
          console.error('Rules file changed, reloading...');
          this.loadRules();
        }, 500);
      }
    });

    console.error(`Watching rules file: ${this.rulesPath}`);
  }

  /**
   * 停止文件监听
   */
  private stopFileWatcher(): void {
    if (this.fileWatcher) {
      unwatchFile(this.rulesPath);
      this.fileWatcher = null;
    }
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
      this.reloadTimeout = null;
    }
  }

  /**
   * 从文件加载规则
   */
  private loadRules(): void {
    // 重新获取配置，确保路径是最新的
    this.rulesPath = getConfig().rulesPath;
    
    // 确保目录存在
    ensureRulesDirectory(this.rulesPath);
    
    if (!existsSync(this.rulesPath)) {
      // 创建默认规则文件
      const defaultData: MockRulesData = {
        rules: [],
        version: '1.0.0',
      };
      this.saveRulesToFile(defaultData);
      return;
    }

    try {
      const content = readFileSync(this.rulesPath, 'utf-8');
      const data: MockRulesData = JSON.parse(content);
      
      // 加载规则到内存
      this.rules.clear();
      for (const rule of data.rules) {
        if (rule.enabled) {
          this.rules.set(rule.id, rule);
        }
      }
      
      console.error(`Rules loaded from: ${this.rulesPath}, total: ${this.rules.size} rules`);
    } catch (error) {
      console.error('Failed to load rules:', error);
      this.rules.clear();
    }
  }

  /**
   * 重新加载规则（用于文件修改后手动刷新）
   */
  reloadRules(): void {
    console.error('Reloading rules from file...');
    this.loadRules();
  }

  /**
   * 销毁规则管理器（清理资源）
   */
  destroy(): void {
    this.stopFileWatcher();
  }

  /**
   * 保存规则到文件
   */
  private saveRulesToFile(data: MockRulesData): void {
    try {
      // 确保目录存在
      ensureRulesDirectory(this.rulesPath);
      writeFileSync(this.rulesPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save rules:', error);
      throw error;
    }
  }

  /**
   * 持久化所有规则
   */
  private persistRules(): void {
    const data: MockRulesData = {
      rules: Array.from(this.rules.values()),
      version: '1.0.0',
    };
    this.saveRulesToFile(data);
    
    // 自动生成 Charles 配置文件
    this.generateCharlesConfig();
  }

  /**
   * 生成 Charles 配置文件
   * 如果配置中指定了目标域名，则自动生成
   */
  private generateCharlesConfig(): void {
    try {
      const config = getConfig() as any; // 使用 any 以访问扩展配置字段
      const rules = Array.from(this.rules.values());
      
      // 如果没有规则，不生成配置
      if (rules.length === 0) {
        return;
      }
      
      // Charles 域名/端口仅从项目根 miMockServerConfig.json 读取，mockServe 内不设预设
      const domains = config.charlesTargetDomains ?? (config.charlesTargetDomain ? [config.charlesTargetDomain] : []);
      const targetPort = config.charlesTargetPort;
      if (domains.length === 0) {
        console.error(
          '[Charles] 未读取到 charlesTargetDomains 配置，已跳过生成。请在项目根目录的 miMockServerConfig.json 中配置 charlesTargetDomains（数组）和 charlesTargetPort（可选，默认 443）。'
        );
        return;
      }
      if (targetPort == null || targetPort === undefined) {
        console.error(
          '[Charles] 未读取到 charlesTargetPort 配置，已使用默认 443。建议在项目根 miMockServerConfig.json 中配置 charlesTargetPort。'
        );
      }
      const port = targetPort ?? 443;
      const mockServerPort = config.port || 7979;
      const rulesDir = dirname(this.rulesPath);
      generateCharlesXMLConfigFile(rules, mockServerPort, domains, port, rulesDir);
      console.error(`Charles 配置文件已自动生成到: ${rulesDir}（${domains.length} 个域名）`);
    } catch (error) {
      // 生成失败不影响规则保存，只记录错误
      console.error('自动生成 Charles 配置失败:', error);
    }
  }

  /**
   * 添加规则
   */
  addRule(rule: Omit<MockRule, 'id' | 'createdAt' | 'updatedAt'>): MockRule {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    const newRule: MockRule = {
      ...rule,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.rules.set(id, newRule);
    this.persistRules();
    
    return newRule;
  }

  /**
   * 删除规则
   */
  removeRule(id: string): boolean {
    const removed = this.rules.delete(id);
    if (removed) {
      this.persistRules();
    }
    return removed;
  }

  /**
   * 更新规则
   */
  updateRule(id: string, updates: Partial<Omit<MockRule, 'id' | 'createdAt'>>): MockRule | null {
    const rule = this.rules.get(id);
    if (!rule) {
      return null;
    }

    const updatedRule: MockRule = {
      ...rule,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.rules.set(id, updatedRule);
    this.persistRules();
    
    return updatedRule;
  }

  /**
   * 获取所有规则
   */
  getAllRules(): MockRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 根据 ID 获取规则
   */
  getRuleById(id: string): MockRule | undefined {
    return this.rules.get(id);
  }

  /**
   * 匹配规则
   */
  matchRule(url: string, method: string): RuleMatchResult {
    const normalizedMethod = method.toUpperCase();
    
    console.error(`[RulesManager] Matching: ${normalizedMethod} ${url}, Total rules: ${this.rules.size}`);
    
    for (const rule of this.rules.values()) {
      if (!rule.enabled) {
        console.error(`[RulesManager] Rule ${rule.id} is disabled, skipping`);
        continue;
      }

      // 检查 HTTP 方法
      if (rule.method.toUpperCase() !== normalizedMethod) {
        console.error(`[RulesManager] Method mismatch: rule=${rule.method.toUpperCase()}, request=${normalizedMethod}`);
        continue;
      }

      // 检查 URL 匹配
      const urlMatched = this.matchUrl(rule.url, url);
      console.error(`[RulesManager] URL match: rule=${rule.url}, request=${url}, matched=${urlMatched}`);
      
      if (urlMatched) {
        console.error(`[RulesManager] Rule matched! ID: ${rule.id}`);
        return {
          matched: true,
          rule,
        };
      }
    }

    console.error(`[RulesManager] No rule matched for ${normalizedMethod} ${url}`);
    return {
      matched: false,
    };
  }

  /**
   * URL 匹配（支持通配符）
   */
  private matchUrl(pattern: string, url: string): boolean {
    // 精确匹配
    if (pattern === url) {
      return true;
    }

    // 通配符匹配
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')  // ** 匹配任意路径
      .replace(/\*/g, '[^/]*'); // * 匹配单个路径段

    try {
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(url);
    } catch (error) {
      // 如果正则表达式无效，回退到精确匹配
      return pattern === url;
    }
  }

  /**
   * 根据 URL 和方法删除规则
   */
  removeRuleByUrlAndMethod(url: string, method: string): boolean {
    const normalizedMethod = method.toUpperCase();
    
    for (const [id, rule] of this.rules.entries()) {
      if (rule.url === url && rule.method.toUpperCase() === normalizedMethod) {
        this.rules.delete(id);
        this.persistRules();
        return true;
      }
    }
    
    return false;
  }
}

// 单例实例
let rulesManagerInstance: RulesManager | null = null;

/**
 * 获取规则管理器实例
 */
export function getRulesManager(): RulesManager {
  if (!rulesManagerInstance) {
    rulesManagerInstance = new RulesManager();
  }
  return rulesManagerInstance;
}

/**
 * 重新加载规则（供外部调用）
 */
export function reloadRules(): void {
  const manager = getRulesManager();
  manager.reloadRules();
}
