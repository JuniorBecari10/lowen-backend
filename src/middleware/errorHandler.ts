import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { AppError } from "../shared/errors.js";

/**
 * Handler final de erros. Nunca inclui stack trace ou segredos na resposta.
 * Sempre devolve code, message, requestId e (quando aplicável) retryAt.
 */
export function errorHandler(
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
) {
    const requestId = (req.header("x-request-id") ?? randomUUID()).slice(0, 64);

    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            code: err.code,
            message: err.message,
            requestId,
            ...(err.retryAt ? { retryAt: err.retryAt } : {}),
        });
        return;
    }

    if (err instanceof ZodError) {
        res.status(400).json({
            code: "INVALID_INPUT",
            message: "Dados de entrada inválidos.",
            requestId,
            details: err.flatten(),
        });
        return;
    }

    // Erro não mapeado: logar apenas com requestId (sem corpo de requisição/segredos).
    console.error(`[${requestId}] erro não tratado:`, err);
    res.status(500).json({
        code: "INTERNAL_ERROR",
        message: "Erro interno. Tente novamente.",
        requestId,
    });
}

export function notFoundHandler(_req: Request, res: Response) {
    res.status(404).json({ code: "NOT_FOUND", message: "Rota inexistente." });
}
