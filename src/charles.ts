import { MockRule } from './types.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getProjectRoot } from './config.js';

/**
 * Charles Map Remote 配置项
 */
interface CharlesMapRemoteItem {
  enabled: boolean;
  protocol: string;
  host: string;
  port: string;
  path: string;
  mapToProtocol: string;
  mapToHost: string;
  mapToPort: string;
  mapToPath: string;
}

/**
 * Charles 配置数据结构
 */
interface CharlesConfig {
  version: string;
  mapRemote: {
    enabled: boolean;
    items: CharlesMapRemoteItem[];
  };
}

/**
 * 从 URL 解析协议、主机、端口和路径
 */
function parseUrl(url: string): { protocol: string; host: string; port: string; path: string } {
  // 默认值
  let protocol = 'https';
  let host = 'api.example.com';
  let port = '443';
  let path = '/';

  try {
    // 如果 URL 包含协议
    if (url.includes('://')) {
      const urlObj = new URL(url);
      protocol = urlObj.protocol.replace(':', '');
      host = urlObj.hostname;
      port = urlObj.port || (protocol === 'https' ? '443' : '80');
      path = urlObj.pathname || '/';
    } else {
      // 如果没有协议，假设是路径
      path = url.startsWith('/') ? url : `/${url}`;
    }
  } catch (error) {
    // 解析失败，使用默认值
    console.warn(`Failed to parse URL: ${url}`, error);
  }

  return { protocol, host, port, path };
}

/**
 * 为单个域名生成映射项（从规则提取路径，为该域名+路径生成 http/https 映射）
 */
function buildItemsForDomain(
  domain: string,
  paths: Set<string>,
  mockServerPort: number,
  targetPort: number
): CharlesMapRemoteItem[] {
  const items: CharlesMapRemoteItem[] = [];
  const httpPort = targetPort === 443 ? 80 : targetPort;
  const useWildcard = paths.size > 5 || Array.from(paths).some((p) => p.includes('*'));
  if (useWildcard) {
    items.push(
      { enabled: true, protocol: 'http', host: domain, port: httpPort.toString(), path: '/*', mapToProtocol: 'http', mapToHost: 'localhost', mapToPort: mockServerPort.toString(), mapToPath: '/*' },
      { enabled: true, protocol: 'https', host: domain, port: targetPort.toString(), path: '/*', mapToProtocol: 'http', mapToHost: 'localhost', mapToPort: mockServerPort.toString(), mapToPath: '/*' }
    );
  } else {
    for (const path of paths) {
      items.push(
        { enabled: true, protocol: 'http', host: domain, port: httpPort.toString(), path, mapToProtocol: 'http', mapToHost: 'localhost', mapToPort: mockServerPort.toString(), mapToPath: path },
        { enabled: true, protocol: 'https', host: domain, port: targetPort.toString(), path, mapToProtocol: 'http', mapToHost: 'localhost', mapToPort: mockServerPort.toString(), mapToPath: path }
      );
    }
  }
  return items;
}

/**
 * 生成 Charles Map Remote 配置
 * targetDomain / targetDomains：单个域名或域名数组（预发、测试、线上等），为每个域名精准映射
 * 同时支持 http 和 https 协议
 */
export function generateCharlesConfig(
  rules: MockRule[],
  mockServerPort: number,
  targetDomain?: string | string[],
  targetPort: number = 443
): CharlesConfig {
  const items: CharlesMapRemoteItem[] = [];
  if (rules.length === 0) {
    return { version: '1.0.0', mapRemote: { enabled: true, items: [] } };
  }

  const domains: string[] = Array.isArray(targetDomain)
    ? targetDomain.filter(Boolean)
    : targetDomain
      ? [targetDomain]
      : [];

  // 从规则中提取路径（规则 URL 为 path，如 /api/xxx）
  const pathSet = new Set<string>();
  for (const rule of rules) {
    const parsed = parseUrl(rule.url);
    pathSet.add(parsed.path);
  }

  if (domains.length === 0) {
    // 兼容：无配置域名时用 api.example.com
    const fallback = buildItemsForDomain('api.example.com', pathSet, mockServerPort, targetPort);
    items.push(...fallback);
  } else {
    for (const domain of domains) {
      items.push(...buildItemsForDomain(domain, pathSet, mockServerPort, targetPort));
    }
  }

  return { version: '1.0.0', mapRemote: { enabled: true, items } };
}

/**
 * 生成 Charles Map Remote XML 格式（Charles 原生格式）
 */
export function generateCharlesXMLConfig(
  rules: MockRule[],
  mockServerPort: number,
  targetDomain?: string | string[],
  targetPort: number = 443
): string {
  const config = generateCharlesConfig(rules, mockServerPort, targetDomain, targetPort);
  
  let xml = "<?xml version='1.0' encoding='UTF-8' ?>\n";
  xml += "<?charles serialisation-version='2.0' ?>\n";
  xml += '<map>\n';
  xml += `  <toolEnabled>${config.mapRemote.enabled}</toolEnabled>\n`;
  xml += '  <mappings>\n';

  for (const item of config.mapRemote.items) {
    xml += '    <mapMapping>\n';
    xml += '      <sourceLocation>\n';
    xml += `        <protocol>${item.protocol}</protocol>\n`;
    xml += `        <host>${item.host}</host>\n`;
    xml += `        <port>${item.port}</port>\n`;
    xml += `        <path>${item.path}</path>\n`;
    xml += '      </sourceLocation>\n';
    xml += '      <destLocation>\n';
    xml += `        <protocol>${item.mapToProtocol}</protocol>\n`;
    xml += `        <host>${item.mapToHost}</host>\n`;
    xml += `        <port>${item.mapToPort}</port>\n`;
    xml += `        <path>${item.mapToPath}</path>\n`;
    xml += '      </destLocation>\n';
    xml += '      <preserveHostHeader>false</preserveHostHeader>\n';
    xml += `      <enabled>${item.enabled}</enabled>\n`;
    xml += '    </mapMapping>\n';
  }

  xml += '  </mappings>\n';
  xml += '</map>\n';

  return xml;
}

/**
 * 生成 Charles XML 配置文件
 */
export function generateCharlesXMLConfigFile(
  rules: MockRule[],
  mockServerPort: number,
  targetDomain?: string | string[],
  targetPort: number = 443,
  outputDir?: string
): string {
  const xml = generateCharlesXMLConfig(rules, mockServerPort, targetDomain, targetPort);
  // 如果指定了输出目录，使用指定目录；否则使用 _mock-rules 目录
  const configDir = outputDir || join(getProjectRoot(), '_mock-rules');
  
  // 确保目录存在
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const configPath = join(configDir, 'map-remote.xml');
  writeFileSync(configPath, xml, 'utf-8');

  return configPath;
}
