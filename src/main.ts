import {createApp} from 'vue';
import './style.css';
import App from './App.vue';
import {mount} from "./site";

console.log('hello world!')

createApp(App).mount((() => {
    const app = document.createElement('div');
    mount(app)
    return app;
  })(),
);
