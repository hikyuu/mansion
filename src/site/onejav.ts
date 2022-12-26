import {GM_addStyle} from '$';
import Waterfall, {Selector} from "../waterfall";
import {addPreview, getAvCode} from "../common";
import {Site} from "./site";
import $ from "jquery";


class Onejav implements Site {

  selector: Selector = {
    next: 'a.pagination-next.button.is-primary',
    item: 'div.container div.card.mb-3',
    container: '#waterfall',
    pagination: '.pagination.is-centered',
  };

  mount(): void {

    //todo 190404

    // GM_addStyle(`
    //               .container {max-width: 99%;width: 99%;}
    //               .columns {justify-content:center;}
    //               .column.is-5 {max-width: 82%;flex-grow:0 flex-shrink:0;flex-basis:100%}
    //               .column {flex-grow: 0;flex-shrink: 1;flex-basis: auto;}
    //           `)
    // console.log(`样式添加成功`)

    // 插入自己创建的div
    $('div.container nav.pagination.is-centered').before('<div id=\'card\' ></div>')
    // 将所有番号内容移到新建的div里
    const $onejav = $('div.container div.card.mb-3');
    $('div#card').append($onejav)
    // 瀑布流脚本
    this.waterfall($onejav);
  }

  findImages(elems: JQuery): void {
    if (document.title.search(/OneJAV/) > 0 && elems) {
      // 增加对应所有番号的Javlib的跳转链接,
      for (let index = 0; index < elems.length; index++) {
        let aEle = $(elems[index]).find('h5.title.is-4.is-spaced a')[0]
        let avid = $(aEle).text().replace(/ /g, '').replace(/[\r\n]/g, '') //去掉空格//去掉回车换行
        let normalizeAvid: string = avid
        if (!(/(-)/g).test(avid)) {
          normalizeAvid = getAvCode(avid)
        }

        // 番号预览大图
        addPreview(normalizeAvid, ($img: JQuery) => {
          let divEle = $(elems[index]).find('div.container')[0]
          if (divEle) {
            $(divEle).append($img)
          }
        }, false)
      }
    }
  }

  private waterfall($onejav: JQuery<HTMLElement>) {
    if ($onejav.length) {
      if ($onejav[0].parentElement === null) {
        console.log('当前页面有变动,通知开发者')
        return
      }
      $onejav[0].parentElement.id = "waterfall";

      new Waterfall(this, this.selector).flow();
    }
  }
}

export {
  Onejav
};

