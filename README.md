# MCP Mock Server

一个基于 MCP (Model Context Protocol) 的 Mock 服务器，专为 React Native 应用设计，支持通过 Charles 代理实现零代码侵入的数据 Mock。

## 特性

- ✅ **零代码侵入**: RN 应用只需配置 Charles 代理，无需修改任何业务代码
- ✅ **动态规则管理**: 通过 MCP 工具（在 Cursor 中）动态添加/删除 Mock 规则，无需重启服务
- ✅ **自动生成 Charles 配置**: 添加 Mock 规则后自动生成 Charles 配置文件，无需手动配置代理
- ✅ **数据持久化**: 所有 Mock 规则自动保存到文件，重启后自动恢复，数据不会丢失
- ✅ **自然语言交互**: 在 Cursor 中用自然语言描述即可创建 Mock 接口
- ✅ **灵活配置**: 支持不同 HTTP 方法、状态码、响应头、延迟等

## 架构

```
React Native App → Charles Proxy → MCP Mock Server → 真实API或返回Mock数据
```

## 安装

### 方式一：作为 npm 包使用（推荐）

无需克隆仓库，通过 npx 直接运行，适合在 Cursor 中作为 MCP 服务使用：

1. **在 Cursor 中配置 MCP**  
   编辑 `~/.cursor/mcp.json`（或 Cursor 设置中的 MCP 配置），添加：

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

`-y` 会在首次运行时自动同意安装包。配置完成后重启 Cursor 或重新加载 MCP，即可使用。

2. **配置文件位置**  
   以 npm 包方式运行时，工作目录一般为 Cursor 打开的项目根目录。请在该项目根目录下放置 `miMockServerConfig.json`（可选），或使用默认配置。

### 方式二：本地开发 / 克隆仓库

```bash
# 安装依赖
npm install

# 构建项目
npm run build

# 启动服务
npm start

# 开发模式（使用 tsx）
npm run dev
```

**发布为 npm 包**：在项目根目录执行 `npm publish` 前会自动执行 `npm run build`，仅会发布 `dist` 与 `README.md`。

## 配置

### 基本配置

在**项目根目录**或 mockServe 目录下创建 `miMockServerConfig.json` 文件（可选，有默认配置）：

```json
{
  "port": 7979,
  "rulesPath": "./.mock-rules/rules.json",
  "enableLogging": true,
  "maxLogs": 1000,
  "mockEnabled": true
}
```

**端口自动管理**：
- 默认端口为 **7979**（不常用端口，避免冲突）
- 如果端口被占用，服务会**自动关闭占用该端口的进程**并重启
- 如果无法关闭占用进程，会自动查找并使用其他可用端口
- 启动时会显示实际使用的端口号，请根据提示更新 Charles 配置

### MCP 客户端配置（Cursor）

- **通过 npm 包使用**：见上方「方式一：作为 npm 包使用」，在 `~/.cursor/mcp.json` 中配置 `npx -y mockserver-mcp-charles` 即可。
- **本地克隆方式**：在 Cursor 的 MCP 配置中指定本地入口（`type` 可不填，本服务使用 stdio，Cursor 会自动识别）：

```json
{
  "mcpServers": {
    "mockserver-mcp-charles": {
      "command": "node",
      "args": ["/path/to/mockServe/dist/server.js"]
    }
  }
}
```

## Charles 配置详细步骤

### 方案一：使用 Map Remote（推荐）

将真实 API 请求转发到 MCP Mock Server：

1. **打开 Charles Map Remote 配置**
   - 菜单：`Tools` → `Map Remote...`
   - 或使用快捷键（Mac: `Cmd+Shift+M`, Windows: `Ctrl+Shift+M`）

2. **添加映射规则**
   - 点击 `Add` 按钮
   - **Map From**（源地址）：
     - Protocol: `http` 或 `https`
     - Host: 真实 API 域名（如 `api.example.com`）
     - Port: 真实 API 端口（如 `443` 或 `80`）
     - Path: API 路径（如 `/api/v1/*` 或留空匹配所有路径）
   - **Map To**（目标地址）：
     - Protocol: `http`
     - Host: `localhost` 或本机 IP 地址
     - Port: MCP Mock Server 端口（默认 `7979`）
     - Path: 保持与源路径相同（或留空）

3. **启用规则**
   - 勾选 `Enable Map Remote`
   - 确保规则前的复选框已勾选

4. **示例配置**
   ```
   Map From: https://api.example.com:443/api/*
   Map To:   http://localhost:7979/api/*
   ```

### React Native 应用配置

1. **获取 Charles 代理地址**
   - 打开 Charles → `Proxy` → `Proxy Settings`
   - 查看端口号（默认 HTTP: 8888, HTTPS: 8888）
   - 查看本机 IP 地址（Charles 主界面显示）

2. **配置 RN 应用代理**
   - **iOS 模拟器**: 自动使用系统代理
   - **Android 模拟器**: 
     - 设置 → WLAN → 长按网络 → 修改网络 → 高级选项 → 代理 → 手动
     - 主机名: Charles 显示的 IP（如 `192.168.1.100`）
     - 端口: `8888`
   - **真机调试**:
     - 确保手机和电脑在同一 WiFi
     - 配置手机 WiFi 代理指向电脑 IP:8888

3. **安装 Charles SSL 证书**（HTTPS 请求需要）
   - Charles → `Help` → `SSL Proxying` → `Install Charles Root Certificate`
   - 在设备上安装证书并信任

### 验证配置

1. 启动 MCP Mock Server（默认端口 7979）
2. 在 Charles 中查看请求列表，确认请求被拦截
3. 检查请求是否被转发到 `localhost:7979`
4. 在 MCP Mock Server 日志中查看请求记录

## 使用方式

### 在 Cursor 中创建 Mock 接口

在 Cursor 中，你可以直接使用自然语言创建 Mock 接口：

```
"为接口 /api/user/info 创建一个 Mock，返回以下数据：
{
  "id": 1,
  "name": "张三",
  "email": "zhangsan@example.com"
}"
```

或者：

```
"添加一个 POST /api/login 接口，状态码 200，返回：
{
  "token": "abc123",
  "expires": 3600
}"
```

MCP 服务会：
1. 解析你的请求
2. 调用 `add_mock_rule` 工具
3. 立即创建 Mock 规则并生效
4. **自动生成 Charles 配置文件**（无需手动配置）
5. RN 应用下次请求该接口时自动返回 Mock 数据

### 自动生成 Charles 配置

每次添加 Mock 规则后，系统会自动生成 Charles 配置文件：
- **JSON 格式**: `charles-config/map-remote.json`
- **XML 格式**: `charles-config/map-remote.xml`（推荐使用）

**导入步骤**：
1. 打开 Charles
2. 菜单：`Tools` → `Map Remote...`
3. 点击 `Import Settings` 按钮
4. 选择生成的 XML 文件（`charles-config/map-remote.xml`）
5. 确认导入后，规则会自动生效

**注意**：如果端口被自动调整（如从 7979 变为 3001），配置文件会自动使用新的端口号。

## MCP 工具 API

### add_mock_rule

添加一个新的 Mock 规则。

**参数：**
- `url` (string, 必需): 接口路径，例如 `/api/user/info`
- `method` (string, 可选): HTTP 方法（GET、POST、PUT、DELETE 等），默认为 GET
- `response` (object, 必需): JSON 格式的响应数据
- `statusCode` (number, 可选): HTTP 状态码，默认为 200
- `headers` (object, 可选): 自定义响应头
- `delay` (number, 可选): 响应延迟（毫秒）

**示例：**
```json
{
  "url": "/api/user/info",
  "method": "GET",
  "response": {
    "id": 1,
    "name": "张三"
  },
  "statusCode": 200,
  "delay": 100
}
```

### remove_mock_rule

删除一个 Mock 规则。

**参数：**
- `id` (string, 可选): 规则 ID（如果提供，将优先使用）
- `url` (string, 可选): 接口路径
- `method` (string, 可选): HTTP 方法

**示例：**
```json
{
  "url": "/api/user/info",
  "method": "GET"
}
```

### list_mock_rules

列出所有已配置的 Mock 规则。

**参数：** 无

### toggle_mock

启用或禁用全局 Mock 功能。

**参数：**
- `enabled` (boolean, 必需): 是否启用 Mock 功能

**示例：**
```json
{
  "enabled": true
}
```

### get_request_logs

获取请求日志，用于调试和问题排查。

**参数：**
- `limit` (number, 可选): 返回的日志条数，默认为 100

**示例：**
```json
{
  "limit": 50
}
```

### generate_charles_config

手动生成 Charles 配置文件（通常在添加规则时会自动生成，此工具用于手动触发）。

**参数：**
- `targetDomain` (string, 可选): 目标 API 域名，如果不提供则从规则中提取

**示例：**
```json
{
  "targetDomain": "api.example.com"
}
```

**返回：**
- 包含生成的配置文件路径和导入步骤说明

## 数据持久化

所有 Mock 规则自动保存到 `.mock-rules/rules.json` 文件：

- **自动保存**: 每次通过 MCP 工具添加/删除/修改规则时，立即同步保存到文件
- **自动加载**: 服务启动时自动读取 `rules.json` 并加载所有规则
- **数据不丢失**: 服务重启后，所有规则自动恢复

### 规则文件格式

```json
{
  "rules": [
    {
      "id": "rule-1",
      "url": "/api/user/info",
      "method": "GET",
      "response": {
        "id": 1,
        "name": "张三",
        "email": "zhangsan@example.com"
      },
      "statusCode": 200,
      "enabled": true,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "version": "1.0.0"
}
```

## URL 匹配规则

支持以下 URL 匹配模式：

- **精确匹配**: `/api/user/info` 只匹配 `/api/user/info`
- **通配符 `*`**: `/api/user/*` 匹配 `/api/user/123`、`/api/user/abc` 等
- **通配符 `**`**: `/api/**` 匹配 `/api/user/info`、`/api/order/list` 等任意路径

## 项目结构

```
mockServe/
├── src/
│   ├── server.ts          # MCP 服务器主入口
│   ├── proxy.ts           # HTTP 代理处理器
│   ├── rules.ts           # Mock 规则管理
│   ├── tools.ts           # MCP 工具定义
│   ├── config.ts          # 配置管理
│   ├── charles.ts         # Charles 配置生成
│   └── types.ts           # TypeScript 类型定义
├── .mock-rules/           # Mock 规则存储目录（隐藏目录）
│   └── rules.json         # 规则文件
├── charles-config/        # Charles 配置文件目录（自动生成）
│   ├── map-remote.json    # JSON 格式配置
│   └── map-remote.xml     # XML 格式配置（推荐）
├── package.json
├── tsconfig.json
└── README.md
```

## 开发

```bash
# 开发模式（自动重新编译）
npm run watch

# 在另一个终端运行
npm run dev
```

## 故障排查

### 问题：请求没有被拦截

1. 检查 Charles 代理配置是否正确
2. 确认 RN 应用已配置使用 Charles 代理
3. 检查 MCP Mock Server 是否正在运行（端口 7979）
4. 查看 Charles 请求列表，确认请求是否被拦截

### 问题：Mock 规则不生效

1. 检查规则是否已正确添加（使用 `list_mock_rules` 工具）
2. 确认全局 Mock 功能已启用（使用 `toggle_mock` 工具）
3. 检查 URL 匹配是否正确（支持通配符）
4. 查看请求日志（使用 `get_request_logs` 工具）

### 问题：规则重启后丢失

1. 检查 `.mock-rules/rules.json` 文件是否存在
2. 确认文件权限正确
3. 查看服务启动日志，确认规则是否被加载

## 许可证

MIT
