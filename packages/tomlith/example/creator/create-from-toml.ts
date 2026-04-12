// 使用 createFromToml 创建实例示例
import { createFromToml } from '../../src';
import { AppInstance } from './app-creator';

async function main() {
  try {
    // 从 TOML 配置创建应用实例
    const app = await createFromToml<AppInstance>('./app.toml');
    
    // 使用创建的实例
    console.log('应用名称:', app.name);
    console.log('版本:', app.version);
    console.log('端口:', app.port);
    
    // 启动应用
    app.start();
  } catch (error) {
    console.error('创建实例失败:', error);
  }
}

main();