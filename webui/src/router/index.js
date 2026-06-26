import { createRouter, createWebHashHistory } from 'vue-router';
import ConfigPanel from '../components/ConfigPanel.vue';
import ProxySection from '../components/ProxySection.vue';
import ProxyTester from '../components/ProxyTester.vue';
import ProxyNodes from '../views/ProxyNodes.vue';
import ProxyChains from '../views/ProxyChains.vue';
import TrafficLogs from '../components/TrafficLogs.vue';

const routes = [
  { path: '/', redirect: '/config' },
  { path: '/config', name: 'Config', component: ConfigPanel },
  { path: '/proxies', name: 'ProxySection', component: ProxySection },
  { path: '/nodes', name: 'ProxyNodes', component: ProxyNodes },
  { path: '/chains', name: 'ProxyChains', component: ProxyChains },
  { path: '/tester', name: 'ProxyTester', component: ProxyTester },
  { path: '/logs', name: 'TrafficLogs', component: TrafficLogs }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

export default router;
