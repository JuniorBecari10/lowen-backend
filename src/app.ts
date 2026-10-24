import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { authenticate } from "./middleware/authenticate.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { companyRouter } from "./modules/company/company.routes.js";
import { certificatesRouter } from "./modules/certificates/certificates.routes.js";
import { nfeRouter } from "./modules/nfe/nfe.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { sefazRouter } from "./modules/sefaz/sefaz.routes.js";
import { danfeRouter } from "./modules/danfe/danfe.routes.js";

export function createApp() {
    const app = express();

    app.use(helmet());
    app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
    app.use(express.json({ limit: "1mb" })); // uploads binários (XML/A1) usam multipart nas rotas específicas

    app.get("/health", (_req, res) => res.json({ status: "ok" }));

    // Todas as rotas de negócio exigem sessão válida; a empresa é sempre
    // resolvida a partir do usuário autenticado, nunca de um id no payload.
    const api = express.Router();
    api.use(authenticate);
    api.use(companyRouter);
    api.use(certificatesRouter);
    api.use(nfeRouter);
    api.use(dashboardRouter);
    api.use(sefazRouter);
    api.use(danfeRouter);

    app.use("/api", api);

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}
