import { z } from 'zod';

const ClientSchema = z.object({
  systemId: z.string().min(1).max(16),
  password: z.string().min(1),
  apiKey: z.string().min(1),
  defaultSender: z.string().max(16).optional(),
  defaultLanguage: z.string().length(2).default('en'),
  maxTps: z.number().int().min(1).max(10000).default(50),
  codePatterns: z.array(z.string()).optional(),
  allowedIps: z.array(z.string()).optional(),
  enabled: z.boolean().default(true),
  failureMode: z.enum(['immediate', 'receipt_only']).default('immediate'),
});

export type ClientConfig = z.infer<typeof ClientSchema>;

const SmppSchema = z.object({
  port: z.number().int().default(2775),
  tlsPort: z.number().int().default(2776),
  tlsKeyPath: z.string().optional(),
  tlsCertPath: z.string().optional(),
  enquireLinkTimeoutS: z.number().int().default(90),
  shutdownGracePeriodS: z.number().int().default(5),
});

const OtpBlueSchema = z.object({
  apiUrl: z.string().url().default('https://api.otpblue.com/imsg/api/v1.1/otp/send/'),
  timeoutMs: z.number().int().default(15000),
});

const HealthSchema = z.object({
  port: z.number().int().default(8080),
});

const ConfigSchema = z.object({
  smpp: SmppSchema.optional().transform(v => SmppSchema.parse(v ?? {})),
  otpblue: OtpBlueSchema.optional().transform(v => OtpBlueSchema.parse(v ?? {})),
  health: HealthSchema.optional().transform(v => HealthSchema.parse(v ?? {})),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  clients: z.array(ClientSchema).min(1),
});

export type AppConfig = z.output<typeof ConfigSchema>;

export { ConfigSchema, ClientSchema };
