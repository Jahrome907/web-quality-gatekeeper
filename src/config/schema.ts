import { z } from "zod";

export const ScreenshotSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  fullPage: z.boolean().default(true),
  waitForSelector: z.string().min(1).optional(),
  waitForTimeoutMs: z.number().int().nonnegative().optional()
});

export const ConfigSchema = z.object({
  timeouts: z.object({
    navigationMs: z.number().int().positive(),
    actionMs: z.number().int().positive(),
    waitAfterLoadMs: z.number().int().nonnegative()
  }),
  playwright: z.object({
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    }),
    userAgent: z.string().min(1),
    locale: z.string().min(1),
    colorScheme: z.enum(["light", "dark"])
  }),
  screenshots: z.array(ScreenshotSchema).min(1),
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
