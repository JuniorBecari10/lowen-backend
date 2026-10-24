import { Router } from "express";
import { z } from "zod";
import { requireCompanyByOwner } from "../company/company.service.js";
import { getDashboardAggregates } from "./dashboard.service.js";
import { Errors } from "../../shared/errors.js";

export const dashboardRouter = Router();

const dashboardQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  environment: z.enum(["homologacao", "producao", "all"]).default("all"),
});

dashboardRouter.get("/dashboard", async (req, res, next) => {
  try {
    const company = await requireCompanyByOwner(req.userId!);
    const query = dashboardQuerySchema.parse(req.query);

    const result = await getDashboardAggregates(company, query);

    res.json(result);
  } catch (err) {
    next(err);
  }
});