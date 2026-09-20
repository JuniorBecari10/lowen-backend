import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`API rodando em http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
