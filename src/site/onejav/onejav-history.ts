import MongoDBCollection = Realm.Services.MongoDB.MongoDBCollection;
import {RealmTask} from "../realm-task";
import {GM_setValue} from "$";
import {FORMAT, KEY} from "../../dictionary";
import moment from "moment/moment";
import {LockPool} from "../site-abstract";
import * as realm from "realm-web";
import {computed} from "vue";
import {GM_getValue} from "vite-plugin-monkey/dist/client";
import {Info} from "../sisters";

const realmTask: RealmTask = new RealmTask()

let onejav: MongoDBCollection<History> | undefined = undefined;
const lockPool = new LockPool();
//数据可能会很多不要滥用响应式
export let histories: History[] = [];
export const historySerialNumbers = new Map();

export const todayHistories = computed<History[]>(() => {
	console.time('todayHistories-filter')
	const filter = histories.filter((history) => {
		return history.pathDate === location.pathname;
	});
	console.timeEnd('todayHistories-filter')
	return filter;
});

export async function loadRemoteHistory() {
	const onejav = getOnejavHistory();
	const remoteHistories = await onejav.find();
	histories = remoteHistories;

	let count = 0;
	for (const history of remoteHistories) {
		//Aug. 24, 2023
		if (!history.pathDate || history.pathDate.length <= 0) {
			count++;
			console.log('修复数据', history.serialNumber);
			realmTask.addTask(history, work);
		}
		if (!historySerialNumbers.has(history.serialNumber)) {
			console.log('添加远程数据')
			historySerialNumbers.set(history.serialNumber, history);
			histories.push(history);
		}
	}
	setLocalHistory();
}

export function loadLocalHistory() {
	const localHistories = getLocalHistory();
	histories = localHistories;
	for (let localHistory of localHistories) {
		historySerialNumbers.set(localHistory.serialNumber, localHistory);
	}
}

const work = async (history: History) => {
	const date = moment(history.originalReleaseDate, FORMAT.ORIGINAL_RELEASE_DATE);
	const pathDate = date.format(FORMAT.PATH_DATE).toString();
	const releaseDate = date.toDate();
	try {
		await getOnejavHistory().updateOne({_id: history._id}, {
			$set: {
				pathDate: pathDate,
				releaseDate: releaseDate
			}
		});
		console.log('更新成功', history.serialNumber);
		return Promise.resolve();
	} catch (reason) {
		console.log('更新失败', history.serialNumber, reason);
		return Promise.resolve();
	}
}

export function getOnejavHistory() {
	if (onejav === undefined) {
		const app = realm.App.getApp('mansion-daygh');
		if (app.currentUser === null) {
			console.log('用户未登录');
			throw new Error('用户未登录');
		}
		const mongo = app.currentUser.mongoClient('mongodb-atlas');
		onejav = mongo.db('mansion').collection('onejav');
		return onejav;
	}
	return onejav;
}

export async function uploadHistory(serialNumber: string, info: Info, retry = 3): Promise<void> {

	if (lockPool.locked(serialNumber)) return;

	console.log(`记录`, serialNumber);
	lockPool.lock(serialNumber);

	const momentDate = moment(info.pathDate, FORMAT.PATH_DATE);
	const date = momentDate.toDate();

	const history = {
		serialNumber: serialNumber,
		releaseDate: date,
		originalReleaseDate: info.date,
		pathDate: info.pathDate,
		watchTime: new Date()
	} as History;
	const onejav = getOnejavHistory();

	return onejav.updateOne({serialNumber: serialNumber}, history, {upsert: true}).then(() => {
		console.log(serialNumber, '上传成功');
		histories.push(history);
		historySerialNumbers.set(history.serialNumber, history);
		setLocalHistory();
		//解锁
		lockPool.unlock(serialNumber);
		return Promise.resolve();
	}).catch((reason) => {
		console.error(reason);
		lockPool.unlock(serialNumber);
		console.log('历史上传重复次数', retry);
		if (retry <= 0) {
			return Promise.reject('重试次数用尽');
		}
		return uploadHistory(serialNumber, info, --retry);
	});
}

export function setLocalHistory() {
	GM_setValue(KEY.ONEJAV_HISTORY_KEY, histories);
	console.log('历史记录写入本地')
}

function getLocalHistory(): History[] {
	return GM_getValue(KEY.ONEJAV_HISTORY_KEY, []);
}

export declare interface History {
	_id: string,
	serialNumber: string,
	pathDate: string,
	releaseDate: Date,
	originalReleaseDate: string,
	watchTime: Date,

	[key: string]: any
}