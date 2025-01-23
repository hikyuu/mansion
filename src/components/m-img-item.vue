<script setup lang="ts"></script>

<template>
  <div class="panel-img-box">
    <slot />
  </div>
</template>

<style scoped>
.panel-img-box {
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
