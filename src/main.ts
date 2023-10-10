import {createApp} from 'vue';
import './style.css';
import App from './App.vue';
import $ from "jquery";
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

const app = createApp(App)
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}
app.use(ElementPlus)
	.mount((() => {
			console.log('vue on!')
			const app = document.createElement('div');
			app.setAttribute("id", "vue")
			$('body').append(app);
			return app;
		})(),
	);

app.config.errorHandler = (err, instance, info) => {
	// 处理错误，例如：报告给一个服务
	console.error(err);
}
