import { defineStore } from 'pinia'
import { createClient, type Session, SupabaseClient } from '@supabase/supabase-js'
import { ElNotification } from 'element-plus'
import { clearDailies } from '@/dao/onejav-daily-dao'
import { clearHistory } from '@/dao/browse-history'
// 你可以任意命名 `defineStore()` 的返回值，但最好使用 store 的名字，同时以 `use` 开头且以 `Store` 结尾。
// (比如 `useUserStore`，`useCartStore`，`useProductStore`)
// 第一个参数是你的应用中 Store 的唯一 ID。
const supabase = createClient(
  'https://tlxamlurkzfqblzyfztp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRseGFtbHVya3pmcWJsenlmenRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzI0NzY3NjAsImV4cCI6MjA0ODA1Mjc2MH0.WtULPMnex03muMRS1L1M52yuxNTeEAG6nB3g_C2Q-CI'
)
export const useUserStore = defineStore('user', {
  state: (): { session: Session | null; initial: boolean } => {
    return {
      initial: false,
      session: null as Session | null
    }
  },
  getters: {
    getAnonSupabase() {
      return supabase
    }
  },
  actions: {
    onAuthStateChange() {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        console.log(event, session)
        if (event === 'INITIAL_SESSION') {
          // handle initial session
        } else if (event === 'SIGNED_IN') {
          // handle sign in event
          this.session = session
          this.initial = true
        } else if (event === 'SIGNED_OUT') {
          // handle sign out event
          this.session = null
          clearDailies()
          clearHistory()
        } else if (event === 'PASSWORD_RECOVERY') {
          // handle password recovery event
          //跳转到密码重置页面
        } else if (event === 'TOKEN_REFRESHED') {
          this.session = session
          // handle token refreshed event
        } else if (event === 'USER_UPDATED') {
          this.session = session
          // handle user updated event
        }
      })
    },
    getSession() {
      supabase.auth.getSession().then(({ data, error }) => {
        if (error) {
          console.error('获取用户信息失败', error)
        } else {
          console.log('用户信息', data)
        }
      })
    },
    async getAuthSupabase(): Promise<SupabaseClient<any, 'public', any>> {
      if (!this.initial) {
        await supabase.auth.getSession()
      }
      if (!this.session) {
        ElNotification({
          title: '提示',
          message: '请先登录',
          type: 'warning'
        })
        throw new Error('请先登录')
      }
      return supabase
    },
    logout() {
      supabase.auth.signOut().then(() => {
        console.log('退出登录')
      })
    }
  }
})
