import {Onejav} from "./onejav";

export function mount(app: HTMLDivElement) {
  const site = getSite();
  if (site === undefined) {
    console.log(`不支持当前网站!`)
    return
  }
  site.mount();
}

function getSite() {
  if ((/(OneJAV)/g).test(document.title)) {
    return new Onejav();
  }
}
