import { ref } from 'vue'
import type { Ref } from 'vue'
export class Pagination {
  constructor(detail: JQuery) {
    this.detail = detail
  }
  currentURL: string = location.toString()
  pathname: string = location.pathname
  isEnd = false
  nextUrl: string | null = null
  detail: JQuery
  nextDetail: JQuery | null = null
}
