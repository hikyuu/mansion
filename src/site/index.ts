import {Onejav} from "./onejav";
import {Site} from "./site";

export function getSite(sisters: Sisters): Site | undefined {
  if ((/(OneJAV)/g).test(document.title)) {
    return new Onejav(sisters);
  }
  return undefined;
}

interface Info {
  avid: string;
  scrollTop: number;
  src: string;
  date: string;
}

export class Sisters {

  current_index: number | undefined = undefined;
  current_key: string | null = null;
  queue: Array<Info> = [];

  previous() {
    console.log(this)
    if (!this.current_key || this.current_index === undefined || this.current_index <= 0) return
    const $image = $('#show-image')
    const info = this.queue[this.current_index]
    const scrollTop = $image.scrollTop();
    if (info) info.scrollTop = scrollTop ? scrollTop : 0;

    this.current_index = this.current_index - 1;
    this.current_key = this.queue[this.current_index].avid;

    const current = this.queue[this.current_index];
    if (current) $image.scrollTop(current.scrollTop);
  }

  nextStep() {
    console.log(this)
    if (!this.current_key || this.current_index === undefined) return
    if (this.current_index >= this.queue.length - 1) return;

    const $image = $('#show-image')
    const info = this.queue[this.current_index];
    const scrollTop = $image.scrollTop();
    if (info) info.scrollTop = scrollTop ? scrollTop : 0;

    this.current_index = this.current_index + 1;
    this.current_key = this.queue[this.current_index].avid

    const current = this.queue[this.current_index];
    if (current) $image.scrollTop(current.scrollTop);
  }

  push(avid: string, src: string, date: string) {
    if (this.queue.length <= 0) {
      this.current_index = 0
      this.current_key = avid;
    }
    const info = this.queue.find(item => item.avid === avid);
    if (!info) {
      this.queue.push({avid, src, scrollTop: 0, date});
    } else {
      info.src = src;
    }
  }
}
