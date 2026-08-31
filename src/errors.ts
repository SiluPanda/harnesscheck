export class HarnessCheckError extends Error {
  public readonly exitCode: number;

  public constructor(message: string, exitCode = 1, options?: ErrorOptions) {
    super(message, options);
    this.name = "HarnessCheckError";
    this.exitCode = exitCode;
  }
}

export class ConfigError extends HarnessCheckError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, 2, options);
    this.name = "ConfigError";
  }
}
