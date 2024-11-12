export enum KEY {
  ONEJAV_HISTORY_KEY = 'onejav_history',
  ONEJAV_DAILY_KEY = 'onejav_daily',
  JAVSTORE_KEY = 'javstore_'
}

export enum BASEURL {
  JAVDB = 'https://javdb.com'
}

export function picx(url: string) {
  return 'https://github.com/hikyuu/gallery/raw/main/picx/' + url.replace(/^\//, '')
}

export enum FORMAT {
  PATH_DATE = '/YYYY/MM/DD',
  ORIGINAL_RELEASE_DATE = 'MMM. D, YYYY'
}

export const WaterfallStatus = {
  close: {
    msg: '关闭瀑布流',
    code: 0
  },
  lazy: {
    msg: '开启懒加载模式',
    code: 1
  },
  oneStep: {
    msg: '开始一步到位模式',
    code: 2
  }
}
