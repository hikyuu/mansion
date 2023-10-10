import {Onejav} from "./onejav";
import {SiteAbstract} from "./site-abstract";
import {Sisters} from "./sisters";

export function getSite(sisters: Sisters): SiteAbstract | undefined {
  if ((/(OneJAV)/g).test(document.title)) {
    return new Onejav(sisters);
  }
  return undefined;
}

export declare interface Theme{
  primary_color: string;
}
