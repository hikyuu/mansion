import {createApp} from 'vue';
import './style.css';
import App from './App.vue';
import $ from "jquery";

console.log('hello world!')

createApp(App).mount((() => {
    const app = document.createElement('div');
    app.setAttribute("id", "vue")
    $('body').append(app);
    return app;
  })(),
);
