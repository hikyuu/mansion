import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'
import { ElNotification } from 'element-plus'

// 创建axios实例配置，根据个人所需配置
const axiosInstance = axios.create({
  timeout: 30000, // 超时
  withCredentials: true // 是否跨域
})

// http request
axiosInstance.interceptors.request.use(
  (config) => {
    // 根据个人所需配置，在请求头新增参数信息
    config.headers['Cache-control'] = 'no-cache' // 指示请求或响应消息不缓存
    config.headers['Access-Control-Allow-Origin'] = '*' // 允许跨域
    // 请求方式
    if (config.method == 'get') {
      config.headers['Content-Type'] = 'application/x-www-form-urlencoded'
    } else {
      // json方式
      config.headers['Content-Type'] = 'application/json'
    }
    return config
  },
  (err) => {
    return Promise.reject(err)
  }
)

// http response
axiosInstance.interceptors.response.use(
  (response) => {
    // 根据相应code判断
    if (response.status === 200 || response.data.statusCode === 200) {
      return Promise.resolve(response)
    }
    return Promise.reject(response)
  },
  (error) => {
    const statusTextMap: Record<number, string> = {
      400: '发出的请求有错误，服务器没有进行新建或修改数据的操作',
      401: '登录失效，请重新登录',
      403: '用户得到授权，但是访问是被禁止的',
      404: '网络请求不存在',
      406: '请求的格式不可得',
      410: '请求的资源被永久删除，且不会再得到的',
      422: '当创建一个对象时，发生一个验证错误',
      500: '服务器发生错误，请检查服务器',
      502: '网关错误',
      503: '服务不可用，服务器暂时过载或维护',
      504: '网关超时'
    }

    if (error.response && error.response.status) {
      const statusText = statusTextMap[error.response.status] ?? '其他错误'
      ElNotification.error({
        title: '错误',
        message: `${statusText}(${error.response.status})`
      })
      return Promise.reject(error)
    }
    return Promise.reject(new Error('网络请求失败，请稍后重试'))
  }
)

// 导出方法
export default {
  post(url: string, data: object, config: AxiosRequestConfig) {
    return axiosInstance({
      method: 'post',
      url,
      baseURL: config.baseURL,
      data
    })
  },
  get(url: string, params: object, config: AxiosRequestConfig) {
    return axiosInstance({
      method: 'get',
      url: url,
      params,
      baseURL: config.baseURL
    })
  }
}
