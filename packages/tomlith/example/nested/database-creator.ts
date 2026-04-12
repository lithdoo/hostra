// database-creator.ts
import { TomlCreator } from '../../src';

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