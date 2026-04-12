// 基本的 TOML 读取示例
import { readToml } from '../../src';

// 读取 TOML 文件
const config = readToml('./basic.toml');
console.log('读取到的配置:', config);

// 访问配置值
console.log('应用名称:', config.app.name);
console.log('版本:', config.app.version);
console.log('是否启用:', config.app.enabled);
console.log('端口:', config.server.port);
console.log('主机:', config.server.host);