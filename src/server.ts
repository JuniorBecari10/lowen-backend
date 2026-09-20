import { createApp } from "./app";

const PORT = 8080;

const app = createApp();
const port = Number(process.env.PORT ?? PORT);

app.listen(port, () => {
    console.log(`Listening omn port ${port}`);
})
