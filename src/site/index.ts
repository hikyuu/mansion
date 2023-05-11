import {Onejav} from "./onejav";
import {AbstractSite} from "./AbstractSite";
import {Sisters} from "./Sisters";

export function getSite(sisters: Sisters): AbstractSite | undefined {
  if ((/(OneJAV)/g).test(document.title)) {
    return new Onejav(sisters);
  }
  return undefined;
}
