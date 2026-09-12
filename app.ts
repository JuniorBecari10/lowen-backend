import express from "express";
import cors from "cors";

const port = 8080;

const app = express();
app.use(cors());

app.get("/", (req, res) => {
  res.send("Hello, world!");
});

app.listen(port, () => {
  console.log(`Listening on port ${port}...`);
});
