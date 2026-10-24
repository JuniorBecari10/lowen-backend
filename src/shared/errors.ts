export class AppError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
        public readonly retryAt?: string,
    ) {
        super(message);
        this.name = "AppError";
    }
}

export const Errors = {
    invalidInput: (message: string) =>
        new AppError(400, "INVALID_INPUT", message),
    unauthenticated: () =>
        new AppError(401, "UNAUTHENTICATED", "Sessão ausente ou inválida."),
    forbidden: (message = "Operação não autorizada para esta empresa.") =>
        new AppError(403, "FORBIDDEN", message),
    notFound: (message = "Recurso não encontrado.") =>
        new AppError(404, "NOT_FOUND", message),
    conflict: (message: string) => new AppError(409, "CONFLICT", message),
    payloadTooLarge: (message: string) =>
        new AppError(413, "PAYLOAD_TOO_LARGE", message),
    unprocessable: (message: string) =>
        new AppError(422, "UNPROCESSABLE", message),
    tooManyRequests: (message: string, retryAt?: string) =>
        new AppError(429, "TOO_MANY_REQUESTS", message, retryAt),
    upstreamUnavailable: (message: string) =>
        new AppError(502, "UPSTREAM_UNAVAILABLE", message),
};
