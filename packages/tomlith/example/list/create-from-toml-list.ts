// 使用 createFromTomlList 创建多个实例示例
import { createFromTomlList } from '../../src';
import { AppInstance } from '../creator/app-creator';

async function main() {
  try {
    // 从 TOML 列表创建多个应用实例
    const apps = await createFromTomlList<AppInstance>('./apps.toml');
    
    // 使用创建的实例
    console.log(`创建了 ${apps.length} 个应用实例:`);
    
    apps.forEach((app, index) => {
      console.log(`\n应用 ${index + 1}:`);
      console.log('名称:', app.name);
      console.log('版本:', app.version);
      console.log('端口:', app.port);
      app.start();
    });
  } catch (error) {
    console.error('创建实例失败:', error);
  }
}

main();