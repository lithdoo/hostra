interface WindowOption {
    id?: string,
    title: string,
    width: number,
    height: number,
    loadUrl: string, //文件则通过 file 协议打开
    devTool: boolean
}


interface IJsonRpcServer {
    // 打开窗口
    openWindow(option: Partial<WindowOption>): string
    // 关闭窗口
    closeWindow(windowId: string): void
    // 获取所有窗口
    getAllWindows(): WindowOption[]
}