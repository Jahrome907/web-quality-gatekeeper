import { z } from "zod";
import { isAbsolute } from "node:path";

// Security limits to prevent DoS
const MAX_SCREENSHOTS = 50;
const MAX_TIMEOUT_MS = 120000; // 2 minutes
const MAX_WAIT_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRY_COUNT = 5;
const MAX_RETRY_DELAY_MS = 10000;
const MAX_AXE_FILTER_ENTRIES = 50;
const MAX_IGNORE_REGIONS = 25;
const MAX_URL_TARGETS = 25;
const MAX_TREND_HISTORY_PATH = 500;
const MAX_TREND_SNAPSHOTS = 365;
const MAX_GALLERY_SCREENSHOTS_PER_PATH = 60;
const MAX_EXTENDS_REFERENCES = 8;
const MAX_EXTENDS_REFERENCE_LENGTH = 300;
const MAX_TREND_DASHBOARD_WINDOW = 365;
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/;
const WINDOWS_UNC_ABSOLUTE_PATH = /^\\\\/;
export const DEFAULT_RETRY_COUNT = 1;
export const DEFAULT_RETRY_DELAY_MS = 2000;
export const DEFAULT_PIXELMATCH_INCLUDE_AA = false;
export const DEFAULT_PIXELMATCH_THRESHOLD = 0.1;
export const DEFAULT_SCREENSHOT_GALLERY_ENABLED = false;
export const DEFAULT_SCREENSHOT_GALLERY_MAX_PER_PATH = 12;
export const DEFAULT_VISUAL_DIFF_ENGINE = "pixelmatch";

function isSafeRelativeTrendHistoryPath(path: string): boolean {
  if (isAbsolute(path) || WINDOWS_DRIVE_PREFIX.test(path) || WINDOWS_UNC_ABSOLUTE_PATH.test(path)) {
    return false;
  }

  return path.split(/[\\/]+/).every((segment) => segment.length === 0 || segment !== "..");
}

export const VisualIgnoreRegionSchema = z.object({
  x: z.number().int().nonnegative().max(100000),
  y: z.number().int().nonnegative().max(100000),
  width: z.number().int().positive().max(100000),
  height: z.number().int().positive().max(100000)
});

const RuleOrTagListSchema = z
  .array(z.string().min(1).max(100))
  .max(MAX_AXE_FILTER_ENTRIES)
  .refine((values) => new Set(values).size === values.length, {
    message: "Values must not contain duplicates"
  });

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

export const UrlTargetSchema = z.object({
  url: z
    .string()
    .url()
    .refine((candidate) => candidate.startsWith("http://") || candidate.startsWith("https://"), {
      message: "URL target must be an http(s) URL"
    }),
  name: z.string().min(1).max(100)
});

export const TrendSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  historyDir: z
    .string()
    .min(1)
    .max(MAX_TREND_HISTORY_PATH)
    .refine(isSafeRelativeTrendHistoryPath, {
      message: "Trend historyDir must be a relative path without '..' segments"
    })
    .default(".wqg-history"),
  maxSnapshots: z.number().int().positive().max(MAX_TREND_SNAPSHOTS).default(90),
  dashboard: z
    .object({
      window: z.number().int().positive().max(MAX_TREND_DASHBOARD_WINDOW).default(30)
    })
    .optional()
});

export const InsightSettingsSchema = z.object({
  enabled: z.boolean().default(true)
});

export const ScreenshotGallerySchema = z.object({
  enabled: z.boolean().default(DEFAULT_SCREENSHOT_GALLERY_ENABLED),
  maxScreenshotsPerPath: z
    .number()
    .int()
    .positive()
    .max(MAX_GALLERY_SCREENSHOTS_PER_PATH)
    .default(DEFAULT_SCREENSHOT_GALLERY_MAX_PER_PATH)
});

export const ConfigSchema = z.object({
  extends: z
    .array(z.string().min(1).max(MAX_EXTENDS_REFERENCE_LENGTH))
    .max(MAX_EXTENDS_REFERENCES)
    .optional(),
  timeouts: z.object({
    navigationMs: z.number().int().positive().max(MAX_TIMEOUT_MS),
    actionMs: z.number().int().positive().max(MAX_TIMEOUT_MS),
    waitAfterLoadMs: z.number().int().nonnegative().max(MAX_WAIT_TIMEOUT_MS)
  }),
  retries: z
    .object({
      count: z.number().int().nonnegative().max(MAX_RETRY_COUNT),
      delayMs: z.number().int().nonnegative().max(MAX_RETRY_DELAY_MS)
    })
    .optional(),
  axe: z
    .object({
      includeRules: RuleOrTagListSchema.optional(),
      excludeRules: RuleOrTagListSchema.optional(),
      includeTags: RuleOrTagListSchema.optional(),
      excludeTags: RuleOrTagListSchema.optional()
    })
    .optional(),
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
    threshold: z.number().min(0).max(1),
    engine: z.enum(["pixelmatch", "native-rust-spike"]).default(DEFAULT_VISUAL_DIFF_ENGINE),
    nativeBinaryPath: z.string().min(1).max(500).optional(),
    pixelmatch: z
      .object({
        includeAA: z.boolean().default(DEFAULT_PIXELMATCH_INCLUDE_AA),
        threshold: z.number().min(0).max(1).default(DEFAULT_PIXELMATCH_THRESHOLD)
      })
      .optional(),
    ignoreRegions: z.array(VisualIgnoreRegionSchema).max(MAX_IGNORE_REGIONS).optional()
  }),
  toggles: z.object({
    a11y: z.boolean(),
    perf: z.boolean(),
    visual: z.boolean()
  }),
  screenshotGallery: ScreenshotGallerySchema.optional(),
  urls: z.array(UrlTargetSchema).min(1).max(MAX_URL_TARGETS).optional(),
  trends: TrendSettingsSchema.optional(),
  insights: InsightSettingsSchema.optional()
});

export type Config = z.infer<typeof ConfigSchema>;
export type ScreenshotDefinition = z.infer<typeof ScreenshotSchema>;
export type UrlTarget = z.infer<typeof UrlTargetSchema>;
export type TrendSettings = z.infer<typeof TrendSettingsSchema>;
export type InsightSettings = z.infer<typeof InsightSettingsSchema>;
