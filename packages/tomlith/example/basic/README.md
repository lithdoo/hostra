# 基本 TOML 读取示例

本示例展示如何使用 `tomlith` 库的 `readToml` 函数读取和解析 TOML 文件。

## 示例文件

- `basic.toml` - 包含基本配置的 TOML 文件
- `basic-read.ts` - 读取和解析 TOML 文件的示例代码

## 功能说明

- **读取 TOML 文件**：使用 `readToml` 函数读取 TOML 文件内容
- **解析配置**：自动将 TOML 内容解析为 JavaScript 对象
- **访问配置值**：通过对象属性访问配置中的各个值

## 运行示例

1. 确保已安装依赖：
   ```bash
   npm install
   ```

2. 构建项目：
   ```bash
   npm run build
   ```

3. 运行示例：
   ```bash
   cd example/basic
   ts-node basic-read.ts
   ```

## 预期输出

```
读取到的配置: {
  app: { name: 'My Application', version: '1.0.0', enabled: true },
  server: { host: 'localhost', port: 3000 },
  database: {
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    name: 'mydb',
    user: 'admin',
    password: 'password'
  }
}
应用名称: My Application
版本: 1.0.0
是否启用: true
端口: 3000
主机: localhost
```