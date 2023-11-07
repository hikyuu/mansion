<script setup lang="ts"></script>

<template>
  <div class="panel-img">
    <slot />
  </div>
</template>

<style scoped>
.panel-img {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  -webkit-user-drag: none;
  user-select: none;
}
</style>
