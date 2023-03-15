import {Onejav} from "./onejav";

export function getSite() {
  if ((/(OneJAV)/g).test(document.title)) {
    return new Onejav();
  }
  return undefined;
}
