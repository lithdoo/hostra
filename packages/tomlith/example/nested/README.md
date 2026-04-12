# 嵌套配置示例

本示例展示如何使用 `tomlith` 库的嵌套配置功能，实现配置的模块化和复用。

## 示例文件

- `app.toml` - 主应用配置文件，引用数据库配置
- `app-creator.ts` - 应用实例创建器，处理嵌套的数据库配置
- `database.toml` - 数据库配置文件
- `database-creator.ts` - 数据库实例创建器
- `nested-config.ts` - 测试嵌套配置功能的示例代码

## 功能说明

- **模块化配置**：将数据库配置分离到单独的 TOML 文件中
- **嵌套解析**：主配置文件通过相对路径引用子配置文件
- **自动处理**：创建器会自动解析嵌套的配置文件并创建相应的实例
- **类型安全**：使用 TypeScript 接口确保配置和实例的类型安全

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
   cd example/nested
   ts-node nested-config.ts
   ```

## 预期输出

```
应用名称: My App
版本: 1.0.0
启动应用: My App v1.0.0
数据库连接: localhost:5432/mydb
连接数据库: localhost:5432/mydb
```