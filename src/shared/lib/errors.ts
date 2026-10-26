export class AppError extends Error {
  public readonly isOperational = true;

  constructor(
    public httpStatus: number,
    public code: string,
    message: string,
    public details?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
