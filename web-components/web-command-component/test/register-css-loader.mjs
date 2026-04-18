import { register } from 'node:module';

register(new URL('./css-resolve-hook.mjs', import.meta.url).href);
