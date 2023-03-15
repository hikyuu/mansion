import Waterfall, {Selector} from "../waterfall";
import {getAvCode, getPreviewUrlFromJavStore, getJavstoreUrl, getPreviewElement} from "../common";
import {Site} from "./site";
import $ from "jquery";
import {GM_getValue, GM_setValue} from "$";
import {dictionary} from "../dictionary";
import waterfall from "../waterfall";
import * as Realm from "realm-web";
import {GM_deleteValue} from "vite-plugin-monkey/dist/client";

const {
  BSON: {ObjectId},
} = Realm;

class Onejav implements Site {

  currentPreviewId: string | undefined = undefined;

  currentHaveRead: boolean = false;

  private waterfall: Waterfall | undefined;

  selector: Selector = {
    next: 'a.pagination-next.button.is-primary',
    item: 'div.container div.card.mb-3',
    container: '#waterfall',
    pagination: '.pagination.is-centered',
  };

  private apiKey = 'JRxCM1RvPBQJ7WAPZ0CUvoNH5XYrmkiOfPz6IBxiJlE0xQZuJj7az0f2MOdfKUAj'

  private lockPool = new LockPool();

  async mount() {

    //todo 190404

    // GM_addStyle(`
    //               .container {max-width: 99%;width: 99%;}
    //               .columns {justify-content:center;}
    //               .column.is-5 {max-width: 82%;flex-grow:0 flex-shrink:0;flex-basis:100%}
    //               .column {flex-grow: 0;flex-shrink: 1;flex-basis: auto;}
    //           `)
    // console.log(`样式添加成功`)

    try {
      const user = await this.loginApiKey(); // add previously generated API key
      await this.syncHistory();

    } catch (e) {
      console.log(e);
    }

    this.home();

    this.observe();

    // GM_deleteValue(dictionary.onejav_history_key);

    // 插入自己创建的div
    $('div.container nav.pagination.is-centered').before('<div id=\'card\' ></div>')
    // 将所有番号内容移到新建的div里
    const $onejav = $('div.container div.card.mb-3');
    $('div#card').append($onejav)

    // 瀑布流脚本
    this.enableWaterfall($onejav);
  }

  private async syncHistory() {

    const onejav = this.getOnejav();
    if (!onejav) return;

    const history = await onejav.find();
    //todo 同步数据
    this.setHistory(history);
  }

  private getOnejav() {
    const app = Realm.App.getApp('mansion-daygh');
    if (app.currentUser === null) {
      console.log('用户未登录');
      return
    }
    const mongo = app.currentUser.mongoClient('mongodb-atlas');
    return mongo.db('mansion').collection('onejav');
  }

  private async loginApiKey() {

    const app = new Realm.App({id: 'mansion-daygh'});
    // Create an API Key credential
    const credentials = Realm.Credentials.apiKey(this.apiKey);

    // Authenticate the user
    const user = await app.logIn(credentials);

    // console.log(user);
    console.log('用户登陆成功');

    return user;
  }

  private async washData() {

    const app = Realm.App.getApp('mansion-daygh');
    const mongo = app.currentUser?.mongoClient('mongodb-atlas');
    const onejav = mongo?.db('mansion').collection('onejav');

  }


  private observe() {
    const overview = $('#overview_list')[0];
    if (overview === undefined) {
      return
    }
    const mutationObserver = new MutationObserver((mutationsList, observer) => {
      console.log(mutationsList);
      const histories = this.getHistories();
      for (let mutationRecord of mutationsList) {
        const nodes = mutationRecord.addedNodes;
        for (let i = 0; i < nodes.length; i++) {
          this.loadHistory($(nodes[i]), histories);
        }
      }
    });

    mutationObserver.observe(overview, {
      attributes: false, // 属性的变动。
      characterData: true, //节点内容或节点文本的变动。
      childList: true, //子节点的变动（指新增，删除或者更改）。
      subtree: false, //布尔值，表示是否将该观察器应用于该节点的所有后代节点。
      attributeOldValue: false, //布尔值，表示观察attributes变动时，是否需要记录变动前的属性值。
      characterDataOldValue: false //布尔值，表示观察characterData变动时，是否需要记录变动前的值。
      //attributeFilter：数组，表示需要观察的特定属性（比如[‘class’,‘src’]）。
    });
  }

  private home() {
    console.log(`===装修首页===`)
    const history = this.getHistories();

    for (let card of $('#overview_list div.card.mb-1.card-overview')) {
      this.loadHistory($(card), history);
    }
    this.markAsRead($('div.column .card'), history);
  }

  private loadHistory(card: JQuery<Node>, history: Array<History>) {
    $('body').find('div.thumbnail-text').css('display', 'unset');
    const header = card.children('header.card-header');
    const title = $(header).children('a.card-header-title')
    const date = title.text().trim()
    // console.log(date);
    if (date !== undefined) {
      const histories = history.filter(item => item.releaseDate === date);

      if (histories.length > 0) {
        title.append(`<span style="white-space:pre">  ${histories.length}部已阅</span>`)

        this.markAsRead(card, histories);

      } else {
        title.append(`<span style="white-space:pre;color: red">  新！！！</span>`)
      }
    }
  }

  private markAsRead(card: JQuery<Node>, histories: History[]) {
    for (let content of card.find('div.card-content a.thumbnail-link')) {
      const contentLink = $(content).attr('href');
      if (contentLink !== undefined) {
        for (let item of histories) {
          if (contentLink.match(new RegExp(item.serialNumber, 'ig'))) {
            $(content).find('div.thumbnail-text').html('<span style="white-space:pre">阅</span>')
          }
        }
      }
    }
  }

  private getHistories() {
    const history: Array<History> = GM_getValue(dictionary.onejav_history_key, []);
    return history;
  }

  private setHistory(history: Array<History>) {
    console.log('写入本地')
    GM_setValue(dictionary.onejav_history_key, history);
  }

  private uploadHistory(id: string, date: string, retry = 0) {

    if (this.lockPool.locked(id)) return;

    console.log(`记录`, id);
    this.lockPool.lock(id);

    const history = {
      serialNumber: id,
      releaseDate: date,
      watchTime: new Date()
    }
    const onejav = this.getOnejav();
    if (!onejav) return;

    onejav.updateOne({serialNumber: id}, history, {upsert: true}).then(
      result => {
        console.log(id, '上传成功');
        const histories = this.getHistories();
        histories.push(history);
        this.setHistory(histories);
        //解锁
        this.lockPool.unlock(id);
      }
    ).catch(reason => {
      console.log('上传重试');
      if (retry >= 3) {
        this.lockPool.unlock(id);
        return
      }
      this.uploadHistory(id, date, retry += 1);
    });
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

    let avid: string = this.getAvId(originalAvid)

    const javstoreUrl = await getJavstoreUrl(avid);
    // const javstoreUrl = null

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
      const preview = getPreviewElement(avid, imgUrl, false);
      let divEle = $(elems[index]).find('div.container')[0]
      if (divEle) {
        $(divEle).append(preview)
      }
    }
  }

  private getAvId(originalAvid: string) {
    const result = originalAvid.matchAll(/(heyzo)(\d+)/gi);

    const groups = Array.from(result);
    if (groups.length > 0) {
      console.log(groups);
      return groups[0][1] + "-" + groups[0][2];
    }


    return originalAvid;
  }

  private addLink(text: string, titleElement: HTMLElement | null, avid: string, elems: JQuery, index: number) {
    //
    const javlib_key = `${dictionary.javlib_key}${avid}`;
    const javlib_id_key = `#${javlib_key}`;
    $(javlib_id_key).remove();
    if (titleElement !== null) {
      $(titleElement).append(`<a id="${javlib_key}" style='color:red;' target='_blank' title='点击重试'>&nbsp;&nbsp;${text}</a>`);
      $(javlib_id_key).on('click', () => {
        $(javlib_id_key).remove();
        $(titleElement).append(`<a id="${javlib_key}" style='color:blue;' target='_blank' title='点击重试'>&nbsp;&nbsp;${text}重试中</a>`);
        console.log(`重试`);
        this.addPreview(elems, index).then();
      });
    }
  }

  private enableWaterfall($onejav: JQuery) {
    if ($onejav.length) {
      if ($onejav[0].parentElement === null) {
        console.log('当前页面有变动,通知开发者')
        return
      }
      $onejav[0].parentElement.id = "waterfall";

      this.waterfall = new Waterfall(this, this.selector);
      this.waterfall.flow();
    }
  }

  scroll(windowHeight: number, scrollTop: number) {
    //滚动高度
    // console.log('===触发滚动===');
    const details = $(document).find(this.selector.item);
    for (let detail of details) {
      const elementTop = $(detail).offset()?.top
      if (elementTop === undefined) return
      const elementHeight = $(detail).height();
      if (elementHeight === undefined) return;

      this.determineTheCurrentElement(detail, scrollTop, windowHeight);

      this.record(elementTop, elementHeight, scrollTop, windowHeight, detail);
    }
  }

  private record(elementTop: number, elementHeight: number, scrollTop: number, windowHeight: number, detail: HTMLElement) {
    if (elementTop + elementHeight >= scrollTop && elementTop + elementHeight <= scrollTop + windowHeight) {
      const id = $(detail).attr('id');
      if (id === undefined) {
        alert('番号样式有变动')
        return;
      }

      const histories = this.getHistories();

      const history = histories.find(item => item.serialNumber === id);

      if (history) {
        // console.log('已经记录', id)
        return;
      }

      const date = $(detail).find('p.subtitle a').text().trim();
      if (date === undefined || date === '') {
        alert('日期样式有变动');
        return;
      }
      this.uploadHistory(id, date);
    }
  }

  private determineTheCurrentElement(detail: HTMLElement, scrollTop: number, windowHeight: number) {
    const preview = $(detail).find("#preview");
    if (preview.length == 0) {
      return;
    }
    const previewTop = $(preview).offset()?.top;
    if (previewTop === undefined) return
    const previewHeight = $(preview).height();
    if (previewHeight === undefined) return;

    if (previewTop <= scrollTop && previewTop + previewHeight > scrollTop) {
      const currentPreviewId = $(detail).attr('id');
      if (this.currentPreviewId === currentPreviewId) {
        return;
      }
      this.currentPreviewId = currentPreviewId;
      console.log('当前图片:' + this.currentPreviewId);
      this.currentHaveRead = this.getHistories().findIndex(item => item.serialNumber === currentPreviewId) >= 0;
    }
  }

  download(): void {
    console.log('下载', this.currentPreviewId);
    const $id = $('#' + this.currentPreviewId);
    // console.log($id);
    const $download = $id.find("a[title='Download .torrent']");
    // console.log($download);
    $download[0].click();
  }

  nextStep(): void {
    const nextPreview = $('#' + this.currentPreviewId).next().find("#preview");
    if (nextPreview.length === 0) {
      console.log('找不到下一张图片')
      return;
    }
    const offset = nextPreview.offset();
    if (offset === undefined) {
      return
    }
    $('html,body').animate({scrollTop: offset.top + 50}, 1000)

  }

  previous(): void {
    const prev = $('#' + this.currentPreviewId).prev().find("#preview");
    if (prev.length === 0) {
      console.log('找不到上一张图片')
      return;
    }
    const offset = prev.offset();
    if (offset === undefined) {
      return
    }
    $('html,body').animate({scrollTop: offset.top}, 1000)
  }

  whetherToDisplay(): boolean {
    const $overview = $('body').find('#overview_list');
    return $overview.length === 0;
  }
}

class LockPool {

  keyPool = new Set();

  lock(key: string) {
    this.keyPool.add(key);
  }

  unlock(key: string) {
    this.keyPool.delete(key);
  }

  locked(key: string) {
    return this.keyPool.has(key);
  }
}

export interface History {
  serialNumber: string,
  releaseDate: string,
  watchTime: Date
}

export {
  Onejav
};

