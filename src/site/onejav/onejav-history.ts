import MongoDBCollection = Realm.Services.MongoDB.MongoDBCollection;
import {RealmTask} from "../realm-task";
import {GM_setValue} from "$";
import {FORMAT, KEY} from "../../dictionary";
import moment from "moment/moment";
import {LockPool} from "../site-abstract";
import * as realm from "realm-web";
import {computed, ref} from "vue";
import {GM_getValue} from "vite-plugin-monkey/dist/client";

const realmTask: RealmTask = new RealmTask()

let onejav: MongoDBCollection<History> | undefined = undefined;
const lockPool = new LockPool();
export const historiesRef = ref<History[]>([]);
export const historiesMapRef = ref(new Map());
export const todayHistories = computed<History[]>(() => {
	return historiesRef.value.filter((history) => {
		return history.pathDate === location.pathname;
	});
});

export async function loadRemoteHistory() {
	const onejav = getOnejavHistory();
	const remoteHistories = await onejav.find();
	historiesRef.value = remoteHistories;

	let count = 0;
	for (const history of remoteHistories) {
		//Aug. 24, 2023
		if (!history.pathDate || history.pathDate.length <= 0) {
			count++;
			console.log('修复数据', history.serialNumber);
			realmTask.addTask(history, work);
		}
		if (!historiesMapRef.value.has(history.serialNumber)) {
			console.log('添加远程数据')
			historiesMapRef.value.set(history.serialNumber, history);
			historiesRef.value.push(history);
		}
	}
	setLocalHistory();
}

export function loadLocalHistory() {
	const localHistories = getLocalHistory();
	historiesRef.value = localHistories;
	for (let localHistory of localHistories) {
		historiesMapRef.value.set(localHistory.serialNumber, localHistory);
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

export async function uploadHistory(id: string, originalReleaseDate: string, retry = 3): Promise<void> {

	if (lockPool.locked(id)) return;

	console.log(`记录`, id);
	lockPool.lock(id);

	const momentDate = moment(originalReleaseDate, FORMAT.ORIGINAL_RELEASE_DATE);
	const date = momentDate.toDate();
	const pathDate = momentDate.format(FORMAT.PATH_DATE).toString();
	const history = {
		serialNumber: id,
		releaseDate: date,
		originalReleaseDate,
		pathDate,
		watchTime: new Date()
	} as History;
	const onejav = getOnejavHistory();

	return onejav.updateOne({serialNumber: id}, history, {upsert: true}).then(() => {
		console.log(id, '上传成功');
		historiesRef.value.push(history);
		historiesMapRef.value.set(history.serialNumber, history);
		setLocalHistory();
		//解锁
		lockPool.unlock(id);
		return Promise.resolve();
	}).catch((reason) => {
		console.error(reason);
		lockPool.unlock(id);
		console.log('历史上传重复次数', retry);
		if (retry <= 0) {
			return Promise.reject('重试次数用尽');
		}
		return uploadHistory(id, originalReleaseDate, --retry);
	});
}

export function setLocalHistory() {
	console.log('历史记录写入本地')
	GM_setValue(KEY.ONEJAV_HISTORY_KEY, historiesRef.value);
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