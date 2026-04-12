# tomlith

一个功能强大的 TOML 解析和创建工具，用于从 TOML 配置文件创建各种实例。

## 功能特点

- 简单易用的 TOML 文件读取和解析
- 支持从 TOML 配置创建实例
- 支持从 TOML 列表创建多个实例
- 支持相对路径和绝对路径解析
- 支持嵌套配置和依赖解析

## 安装

```bash
npm install tomlith
```

从本仓库根目录本地安装：

```bash
npm i ./packages/tomlith
```

## 命令行

将 TOML 解析为 JSON 并输出到标准输出：

```bash
npx tomlith ./config.toml
tomlith --help
```

## 基本用法

### 读取 TOML 文件

```typescript
import { readToml } from 'tomlith';

const config = readToml('./config.toml');
console.log(config);
```

### 从 TOML 创建实例

```typescript
import { createFromToml } from 'tomlith';

// 创建单个实例
const instance = await createFromToml<MyType>('./config.toml');

// 创建带选项的实例
const instanceWithOptions = await createFromToml<MyType>('./config.toml', {
  root: './configs',
  getCreatorByKey: (key) => {
    // 自定义创建器查找逻辑
    return creators[key];
  }
});
```

### 从 TOML 列表创建多个实例

```typescript
import { createFromTomlList } from 'tomlith';

// 创建多个实例
const instances = await createFromTomlList<MyType>('./configs.toml');
```

## TOML 配置示例

### 基本配置

```toml
# config.toml
creator = "./creator.ts"

[config]
name = "example"
version = "1.0.0"
```

### 列表配置

```toml
# configs.toml
[[items]]
creator = "./creator1.ts"

[items.config]
name = "example1"

[[items]]
creator = "./creator2.ts"

[items.config]
name = "example2"
```

## API 文档

### readToml

```typescript
function readToml(path: string): any
```

- **参数**: `path` - TOML 文件路径
- **返回值**: 解析后的 TOML 对象

### createFromToml

```typescript
async function createFromToml<T>(
  tomlPath: string,
  option?: ReadCreatorOpiton,
  targetToml?: any
): Promise<T>
```

- **参数**:
  - `tomlPath` - TOML 文件路径
  - `option` - 读取选项（可选）
  - `targetToml` - 已解析的 TOML 对象（可选）
- **返回值**: 创建的实例

### createFromTomlList

```typescript
async function createFromTomlList<T>(
  tomlPath: string,
  option?: ReadCreatorOpiton
): Promise<T[]>
```

- **参数**:
  - `tomlPath` - TOML 文件路径
  - `option` - 读取选项（可选）
- **返回值**: 创建的实例数组

### TomlCreator

```typescript
type TomlCreator<T> = (config: any, option: {
  tomlPath: string,
  creatorOpiton?: ReadCreatorOpiton,
  createFromToml: (
    tomlPath: string,
    option?: ReadCreatorOpiton,
  ) => Promise<unknown>,
  createFromTomlList: (
    tomlPath: string,
    option?: ReadCreatorOpiton,
  ) => Promise<unknown[]>,
}) => Promise<T>
```

- **参数**:
  - `config` - 配置对象
  - `option` - 选项对象
    - `tomlPath` - 当前 TOML 文件路径
    - `creatorOpiton` - 创建器选项
    - `createFromToml` - 创建单个实例的函数
    - `createFromTomlList` - 创建多个实例的函数
- **返回值**: 创建的实例

### ReadCreatorOpiton

```typescript
type ReadCreatorOpiton = {
  root?: string,
  getCreatorByKey?: (key: string) => TomlCreator<any> | undefined,
}
```

- **属性**:
  - `root` - 根目录路径（可选）
  - `getCreatorByKey` - 通过 key 获取创建器的函数（可选）

## 创建器示例

```typescript
// creator.ts
import { TomlCreator } from 'tomlith';

export interface MyConfig {
  name: string;
  version: string;
}

export const createMyInstance: TomlCreator<MyInstance> = async (config: MyConfig, option) => {
  // 创建实例的逻辑
  return new MyInstance(config.name, config.version);
};

export default createMyInstance;
```

## 高级用法

### 嵌套配置

嵌套配置允许在一个 TOML 文件中引用其他 TOML 文件，实现配置的模块化和复用。

**示例结构：**
- `app.toml` - 主应用配置
- `database-creator.ts` - 数据库实例创建器
- `database.toml` - 数据库配置

**主配置文件 (`app.toml`)：**

```toml
# app.toml
creator = "./app-creator.ts"

[config]
name = "My App"
version = "1.0.0"

# 嵌套数据库配置
database = "./database.toml"
```

**数据库配置文件 (`database.toml`)：**

```toml
# database.toml
creator = "./database-creator.ts"

[config]
host = "localhost"
port = 5432
name = "mydb"
user = "admin"
password = "password"
```

**应用创建器 (`app-creator.ts`)：**

```typescript
// app-creator.ts
import { TomlCreator } from 'tomlith';
import { DatabaseInstance } from './database-creator';

export interface AppConfig {
  name: string;
  version: string;
  database: string | DatabaseInstance;
}

export interface AppInstance {
  name: string;
  version: string;
  database: DatabaseInstance;
  start: () => void;
}

export const createApp: TomlCreator<AppInstance> = async (config: AppConfig, option) => {
  // 解析嵌套的数据库配置
  let database: DatabaseInstance;
  if (typeof config.database === 'string') {
    database = await option.createFromToml(config.database) as DatabaseInstance;
  } else {
    database = config.database;
  }

  return {
    name: config.name,
    version: config.version,
    database,
    start: () => {
      console.log(`启动应用: ${config.name} v${config.version}`);
      console.log(`数据库连接: ${database.host}:${database.port}/${database.name}`);
    }
  };
};

export default createApp;
```

**数据库创建器 (`database-creator.ts`)：**

```typescript
// database-creator.ts
import { TomlCreator } from 'tomlith';

export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}

export interface DatabaseInstance {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  connect: () => void;
}

export const createDatabase: TomlCreator<DatabaseInstance> = async (config: DatabaseConfig) => {
  return {
    ...config,
    connect: () => {
      console.log(`连接数据库: ${config.host}:${config.port}/${config.name}`);
    }
  };
};

export default createDatabase;
```

**使用示例：**

```typescript
import { createFromToml } from 'tomlith';
import { AppInstance } from './app-creator';

async function main() {
  const app = await createFromToml<AppInstance>('./app.toml');
  app.start();
  app.database.connect();
}

main();
```

**预期输出：**

```
启动应用: My App v1.0.0
数据库连接: localhost:5432/mydb
连接数据库: localhost:5432/mydb
```

### 相对路径解析

```typescript
// 相对路径会相对于当前 TOML 文件的目录解析
const instance = await createFromToml('./nested/config.toml');
```

### 绝对路径解析

```typescript
// 绝对路径会直接使用
const instance = await createFromToml('/full/path/to/config.toml');
```

## 注意事项

1. **路径解析**：相对路径会相对于 TOML 文件的目录解析，绝对路径会直接使用
2. **创建器查找**：首先尝试通过 `getCreatorByKey` 查找创建器，失败后会尝试从文件导入
3. **错误处理**：如果找不到创建器，会抛出错误
4. **异步操作**：`createFromToml` 和 `createFromTomlList` 都是异步函数

## 许可证

ISC

## 作者

lithdo <lithdo@outlook.com>