// This starter template is using Vue 3

<script lang="ts">
import Home from "./components/Home.vue";
import {getSite, Sisters} from "./site";
import {defineComponent} from 'vue'
import {Site} from "./site/site";

export default defineComponent({
  name: 'App',
  components: {
    Home
  },
  data() {
    return {
      site: {} as Site,
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
  <!--  <HelloWorld msg="Vite + Vue" />-->
</template>

<style scoped>

</style>
