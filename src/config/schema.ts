import { z } from 'zod';

const ClientSchema = z.object({
  systemId: z.string().min(1).max(16),
  password: z.string().min(1),
  apiKey: z.string().min(1),
  defaultLanguage: z.string().length(2).default('en'),
  maxTps: z.number().int().min(1).max(10000).default(50),
  codePatterns: z.array(z.string()).optional(),
  allowedIps: z.array(z.string()).optional(),
  allowSendText: z.union([
    z.boolean(),
    z.enum(['true', 'false']).transform(v => v === 'true'),
  ]).default(false),
  enabled: z.boolean().default(true),
  failureMode: z.enum(['immediate', 'receipt_only']).default('immediate'),
});

export type ClientConfig = z.infer<typeof ClientSchema>;

const SmppSchema = z.object({
  port: z.number().int().default(2775),
  tlsPort: z.number().int().default(2776),
  tlsKeyPath: z.string().optional(),
  tlsCertPath: z.string().optional(),
  enablePlaintext: z.boolean().default(true),
  enquireLinkTimeoutS: z.number().int().default(90),
  shutdownGracePeriodS: z.number().int().default(5),
  maxConnections: z.number().int().min(1).max(100000).default(1000),
  preBindTimeoutS: z.number().int().min(5).max(300).default(30),
  maxSessionDurationS: z.number().int().min(60).default(86400),
});

const OtpBlueSchema = z.object({
  apiUrl: z.string().url().default('https://api.otpblue.com/imsg/api/v1.1/otp/send/'),
  timeoutMs: z.number().int().default(15000),
});

const HealthSchema = z.object({
  port: z.number().int().default(8080),
  bindAddress: z.string().default('127.0.0.1'),
});

const AuthApiSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().min(1),
  cacheTtlMs: z.number().int().min(0).default(1_800_000), // 30 minutes
});

export type AuthApiConfig = z.output<typeof AuthApiSchema>;

const ConfigSchema = z.object({
  smpp: SmppSchema.optional().transform(v => SmppSchema.parse(v ?? {})),
  otpblue: OtpBlueSchema.optional().transform(v => OtpBlueSchema.parse(v ?? {})),
  health: HealthSchema.optional().transform(v => HealthSchema.parse(v ?? {})),
  authApi: AuthApiSchema,
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type AppConfig = z.output<typeof ConfigSchema>;

export { ConfigSchema, ClientSchema, AuthApiSchema };
