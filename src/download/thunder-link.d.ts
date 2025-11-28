// thunder-link.d.ts
declare interface ThunderLinkTask {
  /**
   * 下载地址（必填）
   * 支持 HTTP、HTTPS、FTP、ed2k、Magnet、Thunder 等下载协议
   */
  url: string

  /**
   * 文件名（含扩展名，可选）
   * 若不填，将自动获取。填写文件名可以加快创建任务的速度
   */
  name?: string

  /**
   * 文件大小，单位：字节（可选）
   * 填写文件大小有助于显示更准确的下载进度
   */
  size?: number

  /**
   * 当前 URL 对应的下载目录，相对于 downloadDir/taskGroupName（可选）
   * 如果填写了 excludePath 则不会生效
   */
  dir?: string
}

declare interface ThunderLinkCreateShortcut {
  /**
   * 快捷方式的名称（必填）
   */
  name: string

  /**
   * 快捷方式所对应的任务组内部文件的相对路径（必填）
   */
  targetFile: string

  /**
   * 快捷方式的运行参数（可选）
   */
  runParams?: string

  /**
   * 快捷方式的起始位置（可选）
   */
  startIn?: string
}

declare interface ThunderLinkNewTaskOptions {
  /**
   * 下载任务数组（必填）
   */
  tasks: ThunderLinkTask[]

  /**
   * 一级下载目录名称（可选）
   * 该目录将创建于剩余存储空间最大的分区根目录
   */
  downloadDir?: string

  /**
   * 任务组和文件夹名称（可选）
   * 会在一级下载目录中创建一个文件夹保存下载的文件
   */
  taskGroupName?: string

  /**
   * 需要从 URL 中排除的路径（可选）
   * 让下载完成的文件保持服务器上的目录结构（以 URL 路径为参考）
   */
  excludePath?: string

  /**
   * 从原始地址进行下载的并发线程数（可选）
   * 部分下载服务器会对单个 IP 的最大同时连接数予以限制
   */
  threadCount?: number

  /**
   * 隐藏新建下载任务界面的"下载到云盘"功能（可选）
   * 设置为 1 时生效
   */
  hideYunPan?: string

  /**
   * 设置连接原始下载服务器时上报的 referer（可选）
   */
  referer?: string

  /**
   * 设置连接原始下载服务器时上报的 userAgent（可选）
   */
  userAgent?: string

  /**
   * 绿色版软件（游戏）的主程序（下载绿色版软件时为必填项）
   * 传入任务组内文件的相对路径
   */
  installFile?: string

  /**
   * 任务组图标（可选）
   * 传入图片 URL，图片内容通常为软件（游戏）的图标
   */
  taskGroupIcon?: string

  /**
   * 下载完成后创建桌面快捷方式（可选）
   * 本参数需配合 taskGroupName 使用
   */
  createShortcut?: ThunderLinkCreateShortcut
}

declare interface ThunderLink {
  /**
   * 创建下载任务
   * @param options 下载任务配置
   */
  newTask(options: ThunderLinkNewTaskOptions): void
}

declare global {
  interface Window {
    /**
     * 迅雷下载 SDK
     */
    thunderLink: ThunderLink
  }
}

export {}
