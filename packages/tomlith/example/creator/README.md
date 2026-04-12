# 创建器示例

本示例展示如何使用 `tomlith` 库的 `createFromToml` 函数从 TOML 配置创建实例。

## 示例文件

- `app-creator.ts` - 应用实例创建器，定义了如何从配置创建应用实例
- `app.toml` - 应用配置文件，包含应用的名称、版本和端口等配置
- `create-from-toml.ts` - 使用 `createFromToml` 函数创建应用实例的示例代码

## 功能说明

- **定义创建器**：创建一个实现 `TomlCreator` 接口的函数，用于从配置创建实例
- **配置 TOML 文件**：在 TOML 文件中指定创建器和配置参数
- **创建实例**：使用 `createFromToml` 函数从 TOML 配置创建实例
- **使用实例**：访问和使用创建的实例的属性和方法

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
   cd example/creator
   ts-node create-from-toml.ts
   ```

## 预期输出

```
应用名称: My App
版本: 1.0.0
端口: 3000
启动应用: My App v1.0.0 端口: 3000
```