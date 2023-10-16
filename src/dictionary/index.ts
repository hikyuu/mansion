export enum KEY {
  ONEJAV_HISTORY_KEY = 'onejav_history',
  ONEJAV_DAILY_KEY = 'onejav_daily',
  JAVSTORE_KEY = 'javstore_'
}

export function picx(url: string) {
  return 'https://github.com/hikyuu/gallery/raw/main/picx/' + url.replace(/^\//, '')
}

export const ICON = {
  HAVE_READ: {
    src: picx('/readed.svg'),
    alt: '已读'
  }
}

export enum FORMAT {
  PATH_DATE = '/YYYY/MM/DD',
  ORIGINAL_RELEASE_DATE = 'MMM. D, YYYY'
}
