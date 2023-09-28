// This starter template is using Vue 3

<script lang="ts">
import Home from "./components/home.vue";
import {getSite} from "./site";
import {defineComponent} from 'vue'
import {Sisters} from "./site/sisters";
import { SiteInterface } from "./site/site-interface";

export default defineComponent({
  name: 'App',
  components: {
    Home
  },
  data() {
    return {
      site: {} as SiteInterface,
      sisters: new Sisters() as Sisters,
    }
  },
  created() {

    const site = getSite(this.sisters);
    if (site === undefined) {
      console.log(`不支持当前网站!`)
      return
    }

    this.site = site;

    this.site.mount();
  },
})

</script>

<template>
  <Home v-if="site" :site="site" :sisters="sisters"/>
</template>

<style scoped>

</style>
