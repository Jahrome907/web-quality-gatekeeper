import { describe, expect, it } from "vitest";
import { escapeHtml, formatMs, formatRatio } from "../src/report/templates/reportTemplate.js";

describe("escapeHtml", () => {
  it("escapes ampersand", () => {
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });

  it("escapes less-than", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes greater-than", () => {
    expect(escapeHtml("a>b")).toBe("a&gt;b");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('a"b')).toBe("a&quot;b");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("a'b")).toBe("a&#39;b");
  });

  it("passes through clean string", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("escapes all special chars together", () => {
    expect(escapeHtml("<div class=\"x\" data-val='y'>&</div>")).toBe(
      "&lt;div class=&quot;x&quot; data-val=&#39;y&#39;&gt;&amp;&lt;/div&gt;"
    );
  });
});

describe("formatMs", () => {
  it("formats number with ms suffix", () => {
    expect(formatMs(1234)).toBe("1234 ms");
  });

  it("rounds to nearest integer", () => {
    expect(formatMs(1234.7)).toBe("1235 ms");
  });

  it("returns n/a for null", () => {
    expect(formatMs(null)).toBe("n/a");
  });

  it("returns n/a for undefined", () => {
    expect(formatMs(undefined)).toBe("n/a");
  });

  it("handles zero", () => {
    expect(formatMs(0)).toBe("0 ms");
  });
});

describe("formatRatio", () => {
  it("formats ratio to 4 decimal places", () => {
    expect(formatRatio(0.0123456)).toBe("0.0123");
  });

  it("returns n/a for null", () => {
    expect(formatRatio(null)).toBe("n/a");
  });

  it("returns n/a for undefined", () => {
    expect(formatRatio(undefined)).toBe("n/a");
  });

  it("handles zero", () => {
    expect(formatRatio(0)).toBe("0.0000");
  });

  it("handles 1.0", () => {
    expect(formatRatio(1)).toBe("1.0000");
  });
});
