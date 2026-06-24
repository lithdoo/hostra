

interface StartOption {
    appName?: string; // app 名字
    port?: number;    // json-rpc 的启动端口 。如果则使用 9333
    cmd: string;      // 子进程启动脚本 （子进程退出则 APP 退出）
}