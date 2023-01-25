import Waterfall, {Selector} from "../waterfall";
import {getAvCode, getPreviewUrlFromJavStore, getJavstoreUrl, getPreviewElement} from "../common";
import {Site} from "./site";
import $ from "jquery";
import {GM_getValue, GM_setValue} from "$";
import {dictionary} from "../dictionary";
import {GM_deleteValue} from "vite-plugin-monkey/dist/client";

class Onejav implements Site {

  private recordHeight = 0;

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

    const history = this.getHistory();
    for (let header of $('header.card-header')) {
      const title = $(header).children('a.card-header-title')
      const href = title.attr('href')
      if (href !== undefined) {
        const list = history[href];
        if (list !== undefined && list.length >= 0) {
          title.append(`<span style="white-space:pre">  ${list.length}部已阅</span>`)
        } else {
          title.append(`<span style="white-space:pre;color: red">  新！！！</span>`)
        }
      }
    }

    // 插入自己创建的div
    $('div.container nav.pagination.is-centered').before('<div id=\'card\' ></div>')
    // 将所有番号内容移到新建的div里
    const $onejav = $('div.container div.card.mb-3');
    $('div#card').append($onejav)

    // 瀑布流脚本
    this.waterfall($onejav);
  }

  private getHistory() {
    const history: History = GM_getValue(dictionary.onejav_history_key, {});
    console.log('读取',history);
    return history;
  }

  private setHistory(history: History) {
    console.log('写入',history)
    GM_setValue(dictionary.onejav_history_key, history);
  }

  async findImages(elems: JQuery): Promise<void> {
    if (document.title.search(/OneJAV/) > 0 && elems) {
      // 增加对应所有番号的Javlib的跳转链接,
      for (let index = 0; index < elems.length; index++) {
        await this.addPreview(elems, index);
      }
    }
  }

  private async addPreview(elems: JQuery, index: number) {
    let aEle = $(elems[index]).find('h5.title.is-4.is-spaced a')[0]
    let originalAvid = $(aEle).text().replace(/ /g, '').replace(/[\r\n]/g, '') //去掉空格//去掉回车换行

    $(elems[index]).attr('id', originalAvid);

    let avid: string = originalAvid
    if (!(/(-)/g).test(originalAvid)) {
      avid = getAvCode(originalAvid)
    }

    const javstoreUrl = await getJavstoreUrl(avid);

    const titleElement = aEle.parentElement;

    if (javstoreUrl === null) {
      this.addLink('没找到', titleElement, avid, elems, index);
      return
    }
    if (titleElement !== null) {
      $(titleElement).append(`<a style='color:red;' href="${javstoreUrl}" target='_blank' title='点击到Javlib看看'>&nbsp;&nbsp;Javlib</a>`);
    }
    // 番号预览大图
    const imgUrl = await getPreviewUrlFromJavStore(javstoreUrl, avid);

    if (imgUrl === null) {
      this.addLink('图片获取失败', titleElement, avid, elems, index);
    } else {
      const preview = getPreviewElement(imgUrl, false);
      let divEle = $(elems[index]).find('div.container')[0]
      if (divEle) {
        $(divEle).append(preview)
      }
    }
  }

  private addLink(text: string, titleElement: HTMLElement | null, avid: string, elems: JQuery, index: number) {
    $(`#${avid}`).remove();
    if (titleElement !== null) {
      $(titleElement).append(`<a id="${avid}" style='color:red;' target='_blank' title='点击重试'>&nbsp;&nbsp;${text}</a>`);
      $(`#${avid}`).on('click', () => {
        $(`#${avid}`).remove();
        if (titleElement !== null) {
          $(titleElement).append(`<a id="${avid}" style='color:blue;' target='_blank' title='点击重试'>&nbsp;&nbsp;${text}中</a>`);
          console.log(`重试`);
          this.addPreview(elems, index).then();
        }
      });
    }
  }

  private waterfall($onejav: JQuery) {
    if ($onejav.length) {
      if ($onejav[0].parentElement === null) {
        console.log('当前页面有变动,通知开发者')
        return
      }
      $onejav[0].parentElement.id = "waterfall";

      new Waterfall(this, this.selector).flow();
    }
  }

  scroll(windowHeight: number, scrollTop: number) {
    if (this.recordHeight + 300 < scrollTop) {
      console.log('===触发滚动===');
      this.recordHeight = scrollTop;
      const history = this.getHistory();
      const details = $(document).find(this.selector.item);
      for (let detail of details) {
        this.record(detail,windowHeight,scrollTop,history);
      }
    }
  }

  private record(detail: HTMLElement, windowHeight: number, scrollTop: number, history: History) {
    const elementTop = $(detail).offset()?.top
    if (elementTop === undefined) return
    const elementHeight = $(detail).height();
    if (elementHeight === undefined) return;
    if (elementTop + elementHeight <= scrollTop + windowHeight) {
      const id = $(detail).attr('id');
      if (id===undefined) {
        return;
      }
      console.log(`记录`,id)
      let list = history[location.pathname];
      if (list === undefined) {
        list = new Array<string>()
        history[location.pathname] = list;
      }

      if (list.includes(id)) {
        return;
      }
      list.push(id);
      this.setHistory(history);
    }
  }
}

export interface History {
  [key: string]: Array<string>
}

export {
  Onejav
};

