type Environment = Record<string, string | undefined>;

const REQUIRED_ENVIRONMENT_VARIABLES = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'REFRESH_TOKEN_SECRET',
  'REFRESH_TOKEN_EXPIRES_IN',
  'CORS_ORIGIN',
] as const;

export function validateEnvironment(environment: Environment): Environment {
  const missing = REQUIRED_ENVIRONMENT_VARIABLES.filter(
    (key) => !environment[key]?.trim(),
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  const databasePort = Number(environment.DATABASE_PORT);
  if (
    !Number.isInteger(databasePort) ||
    databasePort < 1 ||
    databasePort > 65535
  ) {
    throw new Error('DATABASE_PORT must be a valid TCP port');
  }

  for (const key of ['JWT_SECRET', 'REFRESH_TOKEN_SECRET'] as const) {
    if ((environment[key]?.length ?? 0) < 32) {
      throw new Error(`${key} must contain at least 32 characters`);
    }
  }

  if (environment.JWT_SECRET === environment.REFRESH_TOKEN_SECRET) {
    throw new Error('JWT_SECRET and REFRESH_TOKEN_SECRET must be different');
  }

  return environment;
}

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
