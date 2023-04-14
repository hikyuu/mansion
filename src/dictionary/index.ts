enum dictionary {
  onejav_history_key = 'onejav_history',
  javstore_key = 'javstore_',
}

function picx(url: string) {
  return 'https://cdn.staticaly.com/gh/hikyuu/gallery@main/picx/'+url.replace(/^\//, "")
}

export {
  dictionary,
  picx
}
