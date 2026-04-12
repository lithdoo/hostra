# 列表创建示例

本示例展示如何使用 `tomlith` 库的 `createFromTomlList` 函数从 TOML 列表配置创建多个实例。

## 示例文件

- `apps.toml` - 包含多个应用配置的 TOML 列表文件
- `create-from-toml-list.ts` - 使用 `createFromTomlList` 函数创建多个应用实例的示例代码

## 功能说明

- **配置列表**：在 TOML 文件中使用 `[[items]]` 语法定义多个配置项
- **创建多个实例**：使用 `createFromTomlList` 函数从 TOML 列表创建多个实例
- **批量处理**：对创建的多个实例进行批量操作

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
   cd example/list
   ts-node create-from-toml-list.ts
   ```

## 预期输出

```
创建了 3 个应用实例:

应用 1:
名称: App 1
版本: 1.0.0
端口: 3000
启动应用: App 1 v1.0.0 端口: 3000

应用 2:
名称: App 2
版本: 2.0.0
端口: 3001
启动应用: App 2 v2.0.0 端口: 3001

应用 3:
名称: App 3
版本: 3.0.0
端口: 3002
启动应用: App 3 v3.0.0 端口: 3002
```