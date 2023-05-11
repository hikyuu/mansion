import {createApp} from 'vue';
import './style.css';
import App from './App.vue';
import $ from "jquery";

console.log('vue on!')
const app = createApp(App)
app.mount((() => {
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
