import { z } from "zod";

// Security limits to prevent DoS
const MAX_SCREENSHOTS = 50;
const MAX_TIMEOUT_MS = 120000; // 2 minutes
const MAX_WAIT_TIMEOUT_MS = 30000; // 30 seconds

export const ScreenshotSchema = z.object({
  name: z.string().min(1).max(100),
  path: z.string().min(1).max(500).refine(
    (p) => p.startsWith("/") && !p.includes("://"),
    { message: "Screenshot path must be a relative path starting with /" }
  ),
  fullPage: z.boolean().default(true),
  waitForSelector: z.string().min(1).max(500).optional(),
  waitForTimeoutMs: z.number().int().nonnegative().max(MAX_WAIT_TIMEOUT_MS).optional()
});

export const ConfigSchema = z.object({
  timeouts: z.object({
    navigationMs: z.number().int().positive().max(MAX_TIMEOUT_MS),
    actionMs: z.number().int().positive().max(MAX_TIMEOUT_MS),
    waitAfterLoadMs: z.number().int().nonnegative().max(MAX_WAIT_TIMEOUT_MS)
  }),
  playwright: z.object({
    viewport: z.object({
      width: z.number().int().positive().max(7680), // 8K max
      height: z.number().int().positive().max(4320)
    }),
    userAgent: z.string().min(1).max(500),
    locale: z.string().min(1).max(20),
    colorScheme: z.enum(["light", "dark"])
  }),
  screenshots: z.array(ScreenshotSchema).min(1).max(MAX_SCREENSHOTS),
  lighthouse: z.object({
    budgets: z.object({
      performance: z.number().min(0).max(1),
      lcpMs: z.number().min(0),
      cls: z.number().min(0),
      tbtMs: z.number().min(0)
    }),
    formFactor: z.enum(["desktop", "mobile"])
  }),
  visual: z.object({
    threshold: z.number().min(0).max(1)
  }),
  toggles: z.object({
    a11y: z.boolean(),
    perf: z.boolean(),
    visual: z.boolean()
  })
});

export type Config = z.infer<typeof ConfigSchema>;
export type ScreenshotDefinition = z.infer<typeof ScreenshotSchema>;
