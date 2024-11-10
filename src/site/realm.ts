import * as realm from 'realm-web'
import { ElNotification } from 'element-plus'

const apiKey = 'JRxCM1RvPBQJ7WAPZ0CUvoNH5XYrmkiOfPz6IBxiJlE0xQZuJj7az0f2MOdfKUAj'

export async function loginApiKey() {
  if (!apiKey) {
    ElNotification({ title: '数据库', message: `MongoDB登录出错:apiKey不存在`, type: 'error' })
    throw new Error(`MongoDB登录出错:apiKey不存在`)
  }
  try {
    const app = new realm.App({ id: 'mansion-daygh' })
    // Create an API Key credential
    const credentials = realm.Credentials.apiKey(apiKey)
    // Authenticate the user
    const user = await app.logIn(credentials)
    // console.log(user)
    // ElNotification({ title: '数据库', message: `MongoDB登录成功`, type: 'success' })
    return user
  } catch (e) {
    ElNotification({ title: '数据库', message: `MongoDB登录出错:${e}`, type: 'error' })
    throw new Error(`MongoDB登录出错:${e}`)
  }
}
