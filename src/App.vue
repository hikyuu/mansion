// This starter template is using Vue 3

<script lang="ts">
import Home from "./components/Home.vue";
import {getSite} from "./site";
import {defineComponent} from 'vue'

export default defineComponent({
  name: 'App',
  components: {
    Home
  },
  data() {
    return {
      site: getSite(),
    }
  },
  created() {
    if (this.site === undefined) {
      console.log(`不支持当前网站!`)
      return
    }
    this.site.mount();
  },
})

</script>

<template>
  <Home v-if="site" :site="site"/>
  <!--  <HelloWorld msg="Vite + Vue" />-->
</template>

<style scoped>

</style>
