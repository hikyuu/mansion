<script setup lang="ts">
import {Onejav} from "../site/onejav";
import {dailiesRef, OnejavDaily} from "../site/onejav/onejav-daily";
import {computed, toRefs, defineProps} from "vue";
import moment from "moment";
import {FORMAT} from "../dictionary";
import {historiesRef, History} from "../site/onejav/onejav-history";

const props = defineProps<{ onejav: Onejav }>();

const onejav = toRefs<Onejav>(props.onejav);

const latest_dailies = computed<OnejavDaily[]>(() => {
  return dailiesRef.value.sort((a: OnejavDaily, b: OnejavDaily) => {
    return b.releaseDateStamp - a.releaseDateStamp;
  }).filter((daily: OnejavDaily) => daily.loadCompleted).slice(0, Math.min(3, dailiesRef.value.length));
})

const next_dailies = computed<string>(() => {
  return moment(latest_dailies.value[0]?.pathDate, FORMAT.PATH_DATE).add(1, 'days').format(FORMAT.PATH_DATE);
})

function haveReadNumber(pathDate: string) {
  return historiesRef.value.filter((history: History) => history.pathDate === pathDate).length;
}

</script>

<template>
  <div class="panel-img">
    <div class="panel-img-box">
      <el-popover
          trigger="hover"
          placement="left"
          :width="300"
          popper-style="box-shadow: rgb(14 18 22 / 35%) 0px 10px 38px -10px, rgb(14 18 22 / 20%) 0px 10px 20px -15px; padding: 20px;">
        <template #reference>
          <el-icon :size="60" :color="onejav.theme.value.primary_color">
            <List/>
          </el-icon>
        </template>
        <template #default>
          <div style="display: flex; gap: 16px; flex-direction: column">
            <el-text>最新已读</el-text>
            <template v-for="daily in latest_dailies">
              <el-link target="_blank" :href="daily.pathDate"
                       :type="haveReadNumber(daily.pathDate)>=daily.sisterNumber ?'success':'warning'">
                {{ daily.pathDate }} 妹妹:{{ daily.sisterNumber }} 已读:{{ haveReadNumber(daily.pathDate) }}
              </el-link>
            </template>
            <el-text>下一天</el-text>
            <el-link :href="next_dailies" type="danger" target="_blank">
              {{ next_dailies }}
            </el-link>
          </div>
        </template>
      </el-popover>
    </div>
  </div>
</template>

<style scoped>

</style>