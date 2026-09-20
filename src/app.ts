import express from "express";
import cors from "cors";

export function createApp() {
    const app = express();
    app.use(cors({
        origin: process.env.FRONTEND_URL,
        credentials: true,
    }));

    app.use(express.json());
    return app;
}
