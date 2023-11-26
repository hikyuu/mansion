import { SiteAbstract } from '@/site/site-abstract'
import type { Selector } from '@/waterfall/index'
import Waterfall from '@/waterfall/index'
import type { Sisters } from '@/site/sisters'
import type { Ref } from 'vue'

export class javdb implements SiteAbstract {
  public waterfall: Waterfall
  public sisters: Sisters

  constructor(sisters: Sisters) {
    this.sisters = sisters
    this.waterfall = new Waterfall(this, this.selector, sisters)
  }

  selector: Selector = {
    next: 'a.pagination-next.button.is-primary',
    item: 'div.container div.card.mb-3',
    container: 'div.movie-list.h.cols-4.vcols-8',
    pagination: '.pagination.is-centered'
  }
  theme = {
    PRIMARY_COLOR: '#00d1b2'
  }

  addPreview($elem: JQuery): void {}

  download(): void {}

  findImages(elems: JQuery): void {}

  loadCompleted(): void {}

  loadNext(): void {}

  mount(): void {}

  nextStep(x: Ref<number>, y: Ref<number>): void
  nextStep(x: any, y: any): void
  nextStep(x: any, y: any): void {}

  onScrollEvent(windowHeight: number, scrollTop: number): void {}

  previous(x: Ref<number>, y: Ref<number>): void
  previous(x: any, y: any): void
  previous(x: any, y: any): void {}

  save(serialNumber: string): void {}

  showControlPanel(): boolean {
    return false
  }
}
