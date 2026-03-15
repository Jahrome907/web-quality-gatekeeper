import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const localRequire = createRequire(import.meta.url);
const lighthouseEntry = localRequire.resolve("lighthouse");
const lighthouseRequire = createRequire(lighthouseEntry);

export interface PuppeteerRequestLike {
  isNavigationRequest: () => boolean;
  url: () => string;
  continue: () => Promise<void>;
  abort: (errorCode?: string) => Promise<void>;
}

export interface PuppeteerPageLike {
  setRequestInterception: (value: boolean) => Promise<void>;
  on: (event: "request", handler: (request: PuppeteerRequestLike) => Promise<void>) => void;
  close: () => Promise<void>;
}

export interface PuppeteerBrowserLike {
  newPage: () => Promise<PuppeteerPageLike>;
  disconnect: () => Promise<void>;
}

interface PuppeteerModuleLike {
  connect: (options: { browserURL: string; defaultViewport: null }) => Promise<PuppeteerBrowserLike>;
}

export async function loadLighthousePuppeteer(): Promise<PuppeteerModuleLike> {
  const puppeteerEntry = lighthouseRequire.resolve("puppeteer-core");
  const puppeteerModule = await import(pathToFileURL(puppeteerEntry).href);
  return (puppeteerModule.default ?? puppeteerModule) as PuppeteerModuleLike;
}
