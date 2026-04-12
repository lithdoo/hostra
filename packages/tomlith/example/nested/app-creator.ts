// app-creator.ts
import { TomlCreator } from '../../src';
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