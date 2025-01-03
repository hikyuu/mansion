<script setup lang="ts">
import MImgBox from '@/components/m-img-box.vue'
import MImgItem from '@/components/m-img-item.vue'
import { SiteAbstract } from '@/site/site-abstract'
import { ref, reactive, computed } from 'vue'

import { UserFilled } from '@element-plus/icons-vue'
import { ElLoading, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useUserStore } from '@/store/user-store'

const props = defineProps<{
  site: SiteAbstract
}>()

useUserStore().onAuthStateChange()
useUserStore().getSession()

const visible = ref<boolean>(false)
const formRef = ref<FormInstance>()

const isSignUp = ref<boolean>(false)

const isLogin = computed(() => useUserStore().session !== null)

const form = reactive<{
  email: string
  password: string
  confirmPassword: string
}>({
  email: '',
  password: '',
  confirmPassword: ''
})

const validatePass = (rule: any, value: any, callback: any) => {
  if (!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/.test(value)) {
    callback(new Error('密码必须至少包含一个字母和一个数字！'))
  } else {
    callback()
  }
}
const validatePass2 = (rule: any, value: any, callback: any) => {
  if (value !== form.password) {
    callback(new Error('两个输入不匹配！'))
  } else {
    callback()
  }
}

const rules = reactive<FormRules<typeof form>>({
  email: [
    {
      required: true,
      message: '请输入邮箱地址！',
      trigger: 'blur'
    },
    {
      type: 'email',
      message: '邮箱地址格式错误！',
      trigger: ['blur', 'change']
    }
  ],
  password: [
    { required: true, message: '请输入密码！' },
    { min: 6, message: '密码长度必须至少为6个字符！' },
    { max: 20, message: '密码不能超过20个字符！' },
    { validator: validatePass, trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请确认您的密码' },
    { validator: validatePass2, trigger: 'blur' }
  ]
})

const submitForm = (formEl: FormInstance | undefined) => {
  if (!formEl) return
  formEl.validate((valid) => {
    if (valid) {
      console.log('submit!')
      if (isSignUp.value) {
        signUpNewUser()
      } else {
        signInWithEmail()
      }
    } else {
      console.log('error submit!')
    }
  })
}
async function signInWithEmail() {
  const { data, error } = await useUserStore().getAnonSupabase.auth.signInWithPassword({
    email: form.email,
    password: form.password
  })

  if (error) {
    console.error('登录失败', error)
  } else {
    console.log('登录成功', data)
  }
}

async function signUpNewUser() {
  console.log('注册', location.href)
  const loading = ElLoading.service({
    lock: true,
    text: '注册中'
    // background: 'rgba(0, 0, 0, 0.7)'
  })
  const { data, error } = await useUserStore().getAnonSupabase.auth.signUp({
    email: form.email,
    password: form.password,
    options: {
      emailRedirectTo: location.href
    }
  })
  loading.close()
  if (error) {
    console.error('注册失败', error)
    ElMessageBox.alert('注册失败，请联系开发者', '注册失败', {
      confirmButtonText: '好的'
    }).then((r) => {
      console.log('alert', r)
    })
  } else {
    console.log('注册成功', data)
    ElMessageBox.alert('注册成功，请确认邮件', '注册成功', {
      // if you want to disable its autofocus
      // autofocus: false,
      confirmButtonText: '好的'
    }).then((r) => {
      console.log('alert', r)
    })
  }
}
</script>

<template>
  <m-img-box>
    <m-img-item>
      <el-icon style="cursor: pointer" :color="props.site.theme.PRIMARY_COLOR" :size="60" @click="visible = !visible">
        <UserFilled />
      </el-icon>
      <el-drawer
        v-model="visible"
        title="用户中心"
        direction="rtl"
        :append-to-body="true"
        size="50%"
        :close-on-press-escape="true"
        :z-index="99999"
      >
        <template #default>
          <template v-if="!isLogin">
            <el-form
              v-if="isSignUp"
              ref="formRef"
              :model="form"
              label-width="auto"
              style="max-width: 300px"
              :rules="rules"
            >
              <el-form-item prop="email" label="邮箱">
                <el-input v-model="form.email" placeholder="请输入邮箱" clearable />
              </el-form-item>
              <el-form-item prop="password" label="密码">
                <el-input
                  v-model="form.password"
                  type="password"
                  placeholder="请输入密码"
                  show-password
                  autocomplete="off"
                />
              </el-form-item>
              <el-form-item prop="confirmPassword" label="确认密码">
                <el-input
                  v-model="form.confirmPassword"
                  type="password"
                  placeholder="请再次输入密码"
                  show-password
                  autocomplete="off"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="submitForm(formRef)">注册</el-button>
                <el-button type="primary" @click="isSignUp = !isSignUp">登录</el-button>
              </el-form-item>
            </el-form>
            <el-form v-else ref="formRef" :model="form" label-width="auto" style="max-width: 300px" :rules="rules">
              <el-form-item prop="email" label="邮箱">
                <el-input v-model="form.email" placeholder="请输入邮箱" clearable />
              </el-form-item>
              <el-form-item prop="password" label="密码">
                <el-input
                  v-model="form.password"
                  type="password"
                  placeholder="请输入密码"
                  show-password
                  autocomplete="off"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="submitForm(formRef)">登录</el-button>
                <el-button type="primary" @click="isSignUp = !isSignUp">注册</el-button>
              </el-form-item>
            </el-form>
          </template>
          <template v-else>
            <el-text> 已登录 </el-text>
            <el-button type="primary" @click="useUserStore().logout()">登出</el-button>
          </template>
        </template>
      </el-drawer>
    </m-img-item>
  </m-img-box>
</template>

<style scoped></style>
