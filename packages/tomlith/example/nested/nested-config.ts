// 嵌套配置示例
import { createFromToml } from '../../src';
import { AppInstance } from './app-creator';

async function main() {
  try {
    // 从 TOML 配置创建应用实例（包含嵌套的数据库配置）
    const app = await createFromToml<AppInstance>('./app.toml');
    
    // 使用创建的实例
    console.log('应用名称:', app.name);
    console.log('版本:', app.version);
    
    // 启动应用
    app.start();
    
    // 连接数据库
    app.database.connect();
    
  } catch (error) {
    console.error('创建实例失败:', error);
  }
}

main();