import { defineStore } from 'pinia'
import type { Info } from '@/site/sister'

export const useSisterStore = defineStore('sister', {
  state: (): {} => {
    return {
      current_index: undefined as number | undefined,
      current_key: undefined as string | undefined,
      queue: [] as Array<Info>
    }
  },
  getters: {},
  actions: {}
})
