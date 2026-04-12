// 创建器示例
import { TomlCreator } from '../../src';

// 定义配置接口
export interface AppConfig {
  name: string;
  version: string;
  port: number;
}

// 定义应用实例接口
export interface AppInstance {
  name: string;
  version: string;
  port: number;
  start: () => void;
}

// 创建应用实例的函数
export const createApp: TomlCreator<AppInstance> = async (config: AppConfig, option) => {
  return {
    name: config.name,
    version: config.version,
    port: config.port,
    start: () => {
      console.log(`启动应用: ${config.name} v${config.version} 端口: ${config.port}`);
    }
  };
};

export default createApp;