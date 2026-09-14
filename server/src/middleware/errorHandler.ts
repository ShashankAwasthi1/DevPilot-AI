import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    console.error(`[${err.statusCode}] ${err.message}`);
    res.status(err.statusCode).json({
      status: "error",
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  console.error(err);

  res.status(500).json({
    status: "error",
    message: "Internal server error",
  });
}
