import Waterfall, {Selector} from "../../waterfall";
import {getId, getJavstoreUrl, getPreviewElement, getPreviewUrlFromJavStore} from "../../common";
import {AbstractSite, LockPool} from "../AbstractSite";
import $ from "jquery";
import {GM_getValue, GM_setValue} from "$";
import {dictionary, picx} from "../../dictionary";
import * as Realm from "realm-web";
import {GM_addStyle} from "vite-plugin-monkey/dist/client";
import {Sisters} from "../Sisters";

const {
  BSON: {ObjectId},
} = Realm;

export class Onejav implements AbstractSite {

  private onejav: any | undefined = undefined;

  constructor(sisters: Sisters) {
    this.sisters = sisters;
  }

  currentPreviewId: string | undefined = undefined;

  private waterfall: Waterfall | undefined;

  sisters: Sisters;

  selector: Selector = {
    next: 'a.pagination-next.button.is-primary',
    item: 'div.container div.card.mb-3',
    container: '#waterfall',
    pagination: '.pagination.is-centered',
  };

  private apiKey = 'JRxCM1RvPBQJ7WAPZ0CUvoNH5XYrmkiOfPz6IBxiJlE0xQZuJj7az0f2MOdfKUAj'

  private lockPool = new LockPool();

  async mount(): Promise<void> {

    //todo 190404
    this.addStyle();

    const user = await this.loginApiKey(); // add previously generated API key

    await this.syncHistory();

    this.home();

    this.homeLoadObserve();

    this.homeVisible();

    const $onejav = this.homeContainer();
    // 瀑布流脚本
    this.enableWaterfall($onejav, this.sisters);
  }

  private addStyle() {
    GM_addStyle(`
    //               .container {max-width: 99%;width: 99%;}
    //               .columns {justify-content:center;}
    //               .column.is-5 {max-width: 82%;flex-grow:0 flex-shrink:0;flex-basis:100%}
    //               .column {flex-grow: 0;flex-shrink: 1;flex-basis: auto;}
    .max{width:100%}
    .min{width:100%}
              `)
    console.log(`样式添加成功`)
  }

  private homeContainer() {
    // 插入自己创建的div
    $('div.container nav.pagination.is-centered').before('<div id=\'card\' ></div>')
    // 将所有番号内容移到新建的div里
    const $onejav = $('div.container div.card.mb-3');
    $('div#card').append($onejav)
    return $onejav;
  }

  private homeVisible() {
    console.log(`监听页面切换状态`, document.visibilityState)
    $(document).on('visibilitychange', () => {
      if (document.visibilityState == 'visible') {
        console.log(`重新加载首页数据`)
        const windowHeight = $(window).height()
        if (windowHeight === undefined) {
          console.log('获取不到窗口高度')
          return false
        }

        const scrollTop = $(window).scrollTop();
        if (scrollTop === undefined) {
          console.log('获取不到滚动高度')
          return false
        }

        const histories = this.getHistories();
        for (let card of $('#overview_list div.card.mb-1.card-overview')) {
          const cardTop = $(card).offset()!.top;
          const cardHeight = $(card)!.height();
          if (cardHeight === undefined) return;

          if (cardTop >= scrollTop - cardHeight && cardTop <= scrollTop + windowHeight) {
            this.loadHistory($(card), histories);
          }
        }
      }
    });
  }

  private async syncHistory() {

    const onejav = this.getOnejav();
    if (!onejav) return;

    const history = await onejav.find();
    //todo 同步数据
    this.setHistory(history);
  }

  private getOnejav() {
    if (this.onejav === undefined) {
      const app = Realm.App.getApp('mansion-daygh');
      if (app.currentUser === null) {
        console.log('用户未登录');
        return
      }
      const mongo = app.currentUser.mongoClient('mongodb-atlas');
      this.onejav = mongo.db('mansion').collection('onejav');
    }
    return this.onejav;
  }

  private async loginApiKey() {
    try {
      const app = new Realm.App({id: 'mansion-daygh'});
      // Create an API Key credential
      const credentials = Realm.Credentials.apiKey(this.apiKey);
      // Authenticate the user
      const user = await app.logIn(credentials);
      // console.log(user);
      console.log('用户登陆成功');
      return user;
    } catch (e) {
      console.log('MongoDB登录出错', e);
    }
  }

  private homeLoadObserve() {
    const overview = $('#overview_list')[0];
    if (overview === undefined) {
      return
    }
    const mutationObserver = new MutationObserver((mutationsList, observer) => {
      const histories = this.getHistories();
      for (let mutationRecord of mutationsList) {
        mutationRecord.addedNodes.forEach((node, number, parentNode) => {
          if (node.nodeType !== 1) return
          this.loadHistory($(node), histories);
        })
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
    const title = card.find('header.card-header a.card-header-title');
    const content = title.contents()[0].nodeValue;
    if (content === null) return

    const date = content.trim();

    let id = title.attr('id');
    if (id === undefined) {
      id = getId();
      title.attr('id', id);
    }

    if (date !== undefined) {
      const histories = history.filter(item => item.releaseDate === date);

      if (histories.length > 0) {

        title.children(`#${id}`).remove();
        title.append(`<div id="${id}" style="white-space:pre">  ${histories.length}部已阅</div>`)
        this.markAsRead(card, histories);
      } else {
        title.children(`#${id}`).remove();
        title.append(`<div id="${id}" style="white-space:pre;color: red">  新！！！</div>`)
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

  private uploadHistory(id: string, date: string, retry = 3) {

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

    onejav.updateOne({serialNumber: id}, history, {upsert: true})
      .then(() => {
        console.log(id, '上传成功');
        const histories = this.getHistories();
        histories.push(history);
        this.setHistory(histories);
        //解锁
        this.lockPool.unlock(id);
      })
      .catch(() => {
        console.log('上传重试');
        if (retry > 0) {
          this.lockPool.unlock(id);
          return;
        }
        this.uploadHistory(id, date, retry--);
      });
  }

  findImages(elems: JQuery) {
    if (document.title.search(/OneJAV/) > 0 && elems) {
      for (let index = 0; index < elems.length; index++) {
        this.addPreview($(elems[index]))
          .then()
          .catch(reason => {
            console.error(reason);
          });
      }
    }
  }

  private async addPreview($elem: JQuery, type = 0) {

    let detail = $elem.find('h5.title.is-4.is-spaced a')[0]
    const date = $elem.find('p.subtitle a').text().trim();

    let originalAvid = $(detail).text().replace(/ /g, '').replace(/[\r\n]/g, '') //去掉空格//去掉回车换行

    let sortId = this.getAvId(originalAvid, type)
    // let avid: string = 'test123456'
    const titleElement = detail.parentElement;

    this.addLink('搜索中', titleElement, originalAvid, $elem);

    if (type > 0) {
      this.addLink('智能搜索中', titleElement, originalAvid, $elem);
    }

    console.log('添加', originalAvid, date);

    $elem.attr('id', originalAvid);
    const loadUrl = picx('/load.svg');
    const failedUrl = picx("/failed.svg");

    this.sisters.push(originalAvid, loadUrl, date);
    const preview = getPreviewElement(originalAvid, loadUrl, false);
    let divEle = $elem.find('div.container')[0]

    if (divEle) {
      $(divEle).find('#preview').remove();
      $(divEle).append(preview)
    }

    if (sortId === undefined) {
      this.addLink('没找到', titleElement, originalAvid, $elem);
      this.sisters.push(originalAvid, failedUrl, date);
      preview.children("img").attr('src', failedUrl);
      return;
    }

    const javstoreUrl = await getJavstoreUrl(sortId, 3);

    if (javstoreUrl === null) {
      this.sisters.push(originalAvid, failedUrl, date);
      preview.children("img").attr('src', failedUrl);
      this.addPreview($elem, type + 1).then();
      return;
    } else {
      this.addLink('JavStore', titleElement, originalAvid, $elem, javstoreUrl);
    }

    // 番号预览大图
    const imgUrl = await getPreviewUrlFromJavStore(javstoreUrl, originalAvid, 3);

    if (imgUrl === null) {
      this.sisters.push(originalAvid, failedUrl, date);
      preview.children("img").attr('src', failedUrl)

      this.addLink('图片获取失败', titleElement, originalAvid, $elem);
    } else {
      this.sisters.push(originalAvid, imgUrl, date);
      preview.children("img").attr('src', imgUrl)
    }
  }

  private getAvId(originalAvid: string, type: number): string | undefined {
    switch (type) {
      case 0:
        const heyzo = originalAvid.matchAll(/(heyzo)(\d+)/gi);

        const heyzoGroups = Array.from(heyzo);

        if (heyzoGroups.length > 0) {
          console.log(heyzoGroups);
          return heyzoGroups[0][1] + "-" + heyzoGroups[0][2];
        }
        return originalAvid;
      case 1:
        const result = originalAvid.matchAll(/(\d+|[A-Za-z]+)/gi);
        const groups = Array.from(result);
        console.log(groups);
        return groups[1][0] + "-" + groups[2][0];
      default:
        return undefined;
    }
  }

  private addLink(text: string, titleElement: HTMLElement | null, avid: string, elem: JQuery, javstoreUrl: null | string = null) {

    const javstore_key = `${dictionary.javstore_key}${avid}`;
    const javstore_id_key = `#${javstore_key}`;
    const $javstore = $(javstore_id_key);
    $javstore.remove();
    if (titleElement !== null) {
      if (javstoreUrl) {
        $(titleElement).append(`<a id="${javstore_key}" style='color:red;' href="${javstoreUrl}" target='_blank' title='点击到JavStore看看'>&nbsp;&nbsp;JavStore</a>`);
        return
      }
      const $title = $(titleElement);
      $title.append(`<a id="${javstore_key}" style='color:red;' target='_blank' title='点击重试'>&nbsp;&nbsp;${text}</a>`);
      $(javstore_id_key).on('click', () => {
        $(javstore_id_key).css('color', 'blue').text(`\u00A0\u00A0${text}重试中`)
        console.log(`重试`);
        this.addPreview(elem).then();
      });
    }
  }

  private enableWaterfall($onejav: JQuery, sisters: Sisters) {
    if ($onejav.length) {
      if ($onejav[0].parentElement === null) {
        console.log('当前页面有变动,通知开发者')
        return
      }
      $onejav[0].parentElement.id = "waterfall";

      this.waterfall = new Waterfall(this, this.selector, sisters);
      this.waterfall.flow();
    }
  }

  save(avid: string): void {
    const histories = this.getHistories();

    const history = histories.find(item => item.serialNumber === avid);

    if (history) {
      console.log('已经记录', avid)
      return;
    }
    const info = this.sisters.queue.find(item => item.avid === avid);
    if (info) {
      const date = info.date;
      if (date === undefined || date === '') {
        alert('日期样式有变动');
        return;
      }
      this.uploadHistory(avid, date);
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

      // this.record(elementTop, elementHeight, scrollTop, windowHeight, detail);

    }
  }

  private record(elementTop: number, elementHeight: number, scrollTop: number, windowHeight: number, detail: HTMLElement) {
    if (elementTop + elementHeight >= scrollTop && elementTop + elementHeight <= scrollTop + windowHeight) {
      const id = $(detail).attr('id');
      if (id === undefined) return;
    }
  }

  private determineTheCurrentElement(detail: HTMLElement, scrollTop: number, windowHeight: number) {

    const detailTop = $(detail).offset()?.top;
    if (detailTop === undefined) return
    const detailHeight = $(detail).height();
    if (detailHeight === undefined) return;

    if (detailTop <= scrollTop && detailTop + detailHeight > scrollTop) {
      const avid = $(detail).attr('id');
      if (!avid || this.sisters.current_key === avid) {
        return;
      }
      this.sisters.setCurrent(avid);
    }
  }

  haveRead() {
    return this.getHistories().findIndex(item => item.serialNumber === this.sisters.current_key) >= 0;
  }

  download(): void {
    console.log('下载', this.sisters.current_key);
    const $id = $('#' + this.sisters.current_key);
    const $download = $id.find("a[title='Download .torrent']");
    $download[0].click();
  }

  nextStep(): void {
    const nextPreview = $('#' + this.sisters.current_key).find("#preview");
    if (nextPreview.length === 0) return;
    const offset = nextPreview.offset();
    if (offset === undefined) return
    $('html,body').animate({scrollTop: offset.top - 52}, 300)
  }

  previous(): void {
    const prev = $('#' + this.sisters.current_key).find("#preview");
    if (prev.length === 0) return;
    const offset = prev.offset();
    if (offset === undefined) return
    $('html,body').animate({scrollTop: offset.top}, 300)
  }

  whetherToDisplay(): boolean {
    const $overview = $('body').find('#overview_list');
    return $overview.length === 0;
  }

  loadNext(): void {
    this.waterfall?.appendNext();
  }
}

export interface History {
  serialNumber: string,
  releaseDate: string,
  watchTime: Date
}

