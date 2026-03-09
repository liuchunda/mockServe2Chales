# MCP Mock Server

一个基于 MCP (Model Context Protocol) 的 Mock 服务器，专为移动端应用设计，支持通过 Charles 代理实现零代码侵入的数据 Mock。

## 特性

- **零代码侵入**: RN 应用只需配置 Charles 代理，无需修改任何业务代码
- **动态规则管理**: 通过 MCP 工具（在 Cursor 中）动态添加/删除 Mock 规则，无需重启服务
- **自动生成 Charles 配置**: 添加 Mock 规则后自动生成 Charles XML 配置文件
- **多项目支持**: 多个项目可同时使用同一个 MCP 服务，各自占用不同端口，互不干扰
- **数据持久化**: 所有 Mock 规则自动保存到文件，重启后自动恢复
- **自然语言交互**: 在 Cursor 中用自然语言描述即可创建 Mock 接口

## 架构

```
RN App → Charles Proxy → MCP Mock Server（HTTP 代理）→ 返回 Mock 数据
```

---

## 安装与配置

### 1. 在 Cursor 中配置 MCP

编辑 `~/.cursor/mcp.json`，添加：

```json
{
  "mcpServers": {
    "mi-mock-server": {
      "command": "npx",
      "args": ["-y", "mockserver-mcp-charles"]
    }
  }
}
```

配置完成后重启 Cursor 或重新加载 MCP 即可使用。

### 2. 在项目根目录创建配置文件

在**项目根目录**创建 `mockCharlesConfig.json`：

```json
{
  "rulesPath": "_mock-rules/rules.json",
  "charlesTargetDomains": [
    "api.example.com",
    "api-pre.example.com"
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `rulesPath` | 推荐 | Mock 规则文件存储路径（相对于配置文件目录），建议加入 `.gitignore` |
| `charlesTargetDomains` | 必填 | 生成 Charles 映射时的目标域名列表（线上/预发/测试等） |
| `charlesTargetPort` | 可选 | 目标域名端口，默认 `443`（HTTPS 标准端口，通常不需要填写） |
| `projectPrefix` | 可选 | 项目前缀，默认取项目目录名，用于多项目共享代理时区分路由 |

> 其余字段（`port`、`enableLogging`、`maxLogs`、`mockEnabled`）均有合理默认值，无需配置。

---

## 端口机制

- 启动时从默认端口（7979）开始**自动查找可用端口**，不会杀掉其他进程
- 多个项目各自找到空闲端口，天然隔离、互不影响
- 启动成功后控制台打印实际地址，生成 Charles 配置时自动使用该端口

```
┌────────────────────────────────────────────────────────┐
│  Mock HTTP 代理已启动
│  地址:      http://127.0.0.1:7979
│  规则文件:  /path/to/project/_mock-rules/rules.json
└────────────────────────────────────────────────────────┘
```

---

## 多项目支持

多个项目同时使用时，每个项目有独立的 HTTP 代理端口，Charles 映射也各自指向正确端口：

```
项目A → 监听 7979  →  Charles: api-a.com → localhost:7979
项目B → 监听 7980  →  Charles: api-b.com → localhost:7980
```

生成 Charles 配置文件时自动使用当前项目实际监听的端口，无需手动修改。

---

## 使用方式

### 在 Cursor 中创建 Mock 接口

直接用自然语言描述：

```
添加一个 POST 接口 /api/user/info，返回：
{
  "code": 0,
  "data": { "id": 1, "name": "张三" },
  "message": "ok"
}
```

MCP 服务会自动调用 `add_mock_rule` 工具创建规则，并生成 Charles 配置文件。

### 手动生成 Charles 映射文件

在 Cursor 对话框中输入：

```
生成 Charles 映射文件
```

生成的 XML 文件位于 `_mock-rules/map-remote.xml`。

**导入 Charles 步骤**：
1. 打开 Charles → 菜单 `Tools` → `Map Remote...`
2. 点击 `Import Settings`
3. 选择 `_mock-rules/map-remote.xml`
4. 确认导入，规则立即生效

---

## MCP 工具说明

### `add_mock_rule` — 添加 Mock 规则

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | ✅ | 接口路径，如 `/api/user/info` |
| `response` | object | ✅ | JSON 响应数据 |
| `method` | string | — | HTTP 方法，默认 `GET` |
| `statusCode` | number | — | 状态码，默认 `200` |
| `headers` | object | — | 自定义响应头 |
| `delay` | number | — | 响应延迟（毫秒） |

### `remove_mock_rule` — 删除 Mock 规则

通过 `id` 或 `url + method` 删除。

### `list_mock_rules` — 列出所有规则

### `generate_charles_config` — 生成 Charles 配置

| 参数 | 说明 |
|------|------|
| `targetDomains` | 域名数组，不传则从 `mockCharlesConfig.json` 读取 |
| `targetDomain` | 单个域名（兼容旧用法） |
| `targetPort` | 目标端口，不传则从配置读取，默认 `443` |

### `get_request_logs` — 查看请求日志

| 参数 | 说明 |
|------|------|
| `limit` | 返回条数，默认 100 |

### `toggle_mock` — 启用/禁用 Mock

| 参数 | 说明 |
|------|------|
| `enabled` | `true` 启用，`false` 禁用 |

### `reload_rules` — 重新加载规则文件

手动编辑 `rules.json` 后调用，无需重启服务。

---

## URL 匹配规则

| 模式 | 示例 | 说明 |
|------|------|------|
| 精确匹配 | `/api/user/info` | 只匹配完全相同的路径 |
| 单段通配 `*` | `/api/user/*` | 匹配 `/api/user/123`、`/api/user/abc` |
| 多段通配 `**` | `/api/**` | 匹配 `/api/user/info`、`/api/order/list` 等 |

---

## 数据持久化

规则保存在 `rulesPath` 指定的文件中（默认 `_mock-rules/rules.json`）：

```json
{
  "rules": [
    {
      "id": "uuid",
      "url": "/api/user/info",
      "method": "GET",
      "response": { "code": 0, "data": {} },
      "statusCode": 200,
      "enabled": true,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "version": "1.0.0"
}
```

建议将 `_mock-rules/` 加入 `.gitignore`，避免 Mock 数据污染代码仓库。

---

## 项目结构

```
mockserver-mcp-charles/
├── src/
│   ├── server.ts       # MCP 服务器主入口 & HTTP 代理启动
│   ├── proxy.ts        # HTTP 代理请求处理
│   ├── rules.ts        # Mock 规则管理
│   ├── tools.ts        # MCP 工具定义与处理器
│   ├── config.ts       # 配置加载与运行时状态
│   ├── charles.ts      # Charles XML 配置生成
│   └── types.ts        # TypeScript 类型定义
└── _mock-rules/        # 运行时生成（建议 .gitignore）
    ├── rules.json      # Mock 规则持久化文件
    └── map-remote.xml  # Charles Map Remote 配置
```

---

## 故障排查

### 请求没有被 Mock 拦截

1. 确认 Charles 已启用 Map Remote 且规则已导入
2. 确认 RN 应用流量经过 Charles 代理
3. 用 `list_mock_rules` 检查规则是否存在
4. 用 `get_request_logs` 查看请求日志，确认请求是否到达 Mock 服务

### Charles 映射端口不对

重新执行「生成 Charles 映射文件」，配置会自动使用当前实际监听端口，重新导入即可。

### 规则重启后丢失

检查 `rulesPath` 配置的路径是否正确，以及该文件是否被意外删除或加入了 `.gitignore`。

---

## 许可证

MIT
