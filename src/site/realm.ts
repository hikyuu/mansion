import * as realm from "realm-web";

const apiKey = 'JRxCM1RvPBQJ7WAPZ0CUvoNH5XYrmkiOfPz6IBxiJlE0xQZuJj7az0f2MOdfKUAj'
export async function loginApiKey() {
	try {
		const app = new realm.App({id: 'mansion-daygh'});
		// Create an API Key credential
		const credentials = realm.Credentials.apiKey(apiKey);
		// Authenticate the user
		const user = await app.logIn(credentials);
		// console.log(user);
		console.log('用户登陆成功');
		return user;
	} catch (e) {
		console.log('MongoDB登录出错', e);
	}
}