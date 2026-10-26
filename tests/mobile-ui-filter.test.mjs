import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

describe("Mobile Filter Bar Layout & Safe Area", () => {
  it("prevents vertical stretching in app/globals.css mobile media query", () => {
    const cssPath = path.join(ROOT_DIR, "app", "globals.css");
    const css = fs.readFileSync(cssPath, "utf8");

    // Must define compact fixed height for mobile search input
    assert.ok(
      css.includes(".routes-filter-bar .filter-input-search"),
      "globals.css must define mobile rules for .routes-filter-bar .filter-input-search"
    );
    assert.ok(
      css.includes("height: 42px !important"),
      "Search input on mobile must be constrained to 42px height"
    );
    assert.ok(
      css.includes("flex: 0 0 auto !important"),
      "Search input on mobile must reset flex: 0 0 auto to prevent column flexbox height stretch"
    );

    // Filter group grid
    assert.ok(
      css.includes("grid-template-columns: 1fr 1fr !important"),
      "Filter group on mobile must display selects in a 2-column grid"
    );

    // Filter date wrapper
    assert.ok(
      css.includes(".routes-filter-bar .filter-group .filter-date-wrapper"),
      "globals.css must define mobile rules for .filter-date-wrapper"
    );
    assert.ok(
      css.includes("grid-column: 1 / -1 !important"),
      "Date filter on mobile must span the full row width"
    );
  });

  it("applies safe-area padding and compact controls in app/mobile-ui.css", () => {
    const cssPath = path.join(ROOT_DIR, "app", "mobile-ui.css");
    const css = fs.readFileSync(cssPath, "utf8");

    // Safe area top padding for header and [+ Nova rota] button
    assert.ok(
      css.includes("env(safe-area-inset-top"),
      "mobile-ui.css must apply safe-area-inset-top to prevent camera notch overlap"
    );

    // Search and filter group overrides
    assert.ok(
      css.includes(".filter-input-search"),
      "mobile-ui.css must style .filter-input-search"
    );
    assert.ok(
      css.includes(".filter-group .filter-date-wrapper"),
      "mobile-ui.css must style .filter-group .filter-date-wrapper"
    );
  });

  it("renders calendar icon inside filter-date-wrapper in components/routewise-app.tsx", () => {
    const appPath = path.join(ROOT_DIR, "components", "routewise-app.tsx");
    const code = fs.readFileSync(appPath, "utf8");

    assert.ok(
      code.includes('className="filter-date-wrapper"'),
      "routewise-app.tsx must wrap date filter input in .filter-date-wrapper"
    );
    assert.ok(
      code.includes('<Calendar size={14} className="filter-date-icon" />'),
      "routewise-app.tsx must include Calendar icon inside filter-date-wrapper"
    );
  });
});

describe("PWA Standalone Printing & Platform Hand-off", () => {
  it("exports isAndroidPwaStandalone and isIosPwaStandalone in lib/print-document.ts", async () => {
    const { isAndroidPwaStandalone, isIosPwaStandalone } = await import(`../lib/print-document.ts?t=${Date.now()}`);
    assert.strictEqual(typeof isAndroidPwaStandalone, "function");
    assert.strictEqual(typeof isIosPwaStandalone, "function");

    // In Node.js environment, should evaluate to false
    assert.strictEqual(isAndroidPwaStandalone(), false);
    assert.strictEqual(isIosPwaStandalone(), false);
  });

  it("detects iOS standalone PWA and directs to Safari with token / x-safari-", async () => {
    const { isIosPwaStandalone, printElement } = await import(`../lib/print-document.ts?t=${Date.now() + 2}`);

    const storage = new Map();
    const mockDocument = {
      getElementById: (id) => ({
        id,
        cloneNode: () => ({
          outerHTML: '<div id="printable-report"><h1>Romaneio iOS</h1></div>',
          querySelectorAll: () => [],
        }),
      }),
      querySelectorAll: () => [],
      body: {
        classList: { add: () => {}, remove: () => {} },
        appendChild: () => {},
      },
    };

    const mockWindow = {
      location: {
        origin: "https://criarrota.com.br",
        href: "https://criarrota.com.br/",
      },
      matchMedia: (q) => ({ matches: q.includes("standalone") }),
      navigator: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        standalone: true,
      },
      document: mockDocument,
    };

    const prevWin = globalThis.window;
    const prevDoc = globalThis.document;
    const prevNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const prevStorage = globalThis.localStorage;
    const prevFetch = globalThis.fetch;

    globalThis.window = mockWindow;
    globalThis.document = mockDocument;
    Object.defineProperty(globalThis, "navigator", {
      value: mockWindow.navigator,
      configurable: true,
      writable: true,
    });
    globalThis.localStorage = {
      setItem: (k, v) => storage.set(k, v),
      getItem: (k) => storage.get(k),
    };
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ token: "prt_ios123", url: "/imprimir-romaneio?token=prt_ios123" }),
    });

    try {
      assert.strictEqual(isIosPwaStandalone(), true, "Must detect iOS standalone PWA");

      await printElement("printable-report", "Romaneio - Rota Norte", { routeId: "route-999" });

      // Stored in localStorage
      assert.ok(storage.has("routewise_print_html"), "Must store print HTML in localStorage");

      // Directed to Safari via x-safari- URL scheme
      assert.ok(mockWindow.location.href.startsWith("x-safari-"), "Must set window.location.href to x-safari-");
      assert.ok(mockWindow.location.href.includes("token=prt_ios123"), "Must include print token in URL");
    } finally {
      globalThis.window = prevWin;
      globalThis.document = prevDoc;
      if (prevNav) {
        Object.defineProperty(globalThis, "navigator", prevNav);
      }
      globalThis.localStorage = prevStorage;
      globalThis.fetch = prevFetch;
    }
  });

  it("detects Android standalone PWA and constructs Chrome intent navigation", async () => {
    const { isAndroidPwaStandalone, printElement } = await import(`../lib/print-document.ts?t=${Date.now() + 1}`);

    const storage = new Map();
    let navigatedUrl = null;

    const mockDocument = {
      referrer: "android-app://com.google.android.apps.chrome.webapk.abc",
      getElementById: (id) => ({
        id,
        cloneNode: () => ({
          outerHTML: '<div id="printable-report"><h1>Romaneio Teste</h1></div>',
          querySelectorAll: () => [],
        }),
      }),
      querySelectorAll: () => [],
      body: {
        classList: { add: () => {}, remove: () => {} },
        appendChild: () => {},
      },
    };

    const mockWindow = {
      location: {
        origin: "https://criarrota.com.br",
        href: "https://criarrota.com.br/",
      },
      matchMedia: (q) => ({ matches: q.includes("standalone") }),
      navigator: {
        userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/120.0 Mobile",
        standalone: true,
      },
      document: mockDocument,
    };

    const prevWin = globalThis.window;
    const prevDoc = globalThis.document;
    const prevNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const prevStorage = globalThis.localStorage;

    globalThis.window = mockWindow;
    globalThis.document = mockDocument;
    Object.defineProperty(globalThis, "navigator", {
      value: mockWindow.navigator,
      configurable: true,
      writable: true,
    });
    globalThis.localStorage = {
      setItem: (k, v) => storage.set(k, v),
      getItem: (k) => storage.get(k),
    };

    try {
      assert.strictEqual(isAndroidPwaStandalone(), true, "Must detect Android standalone PWA");

      await printElement("printable-report", "Romaneio - Rota Sul", { routeId: "route-123" });

      // Stored in localStorage
      assert.ok(storage.has("routewise_print_html"), "Must store print HTML in localStorage");
      assert.ok(storage.get("routewise_print_html").includes("Romaneio Teste"));
      assert.strictEqual(storage.get("routewise_print_title"), "Romaneio - Rota Sul");
      assert.strictEqual(storage.get("routewise_print_route_id"), "route-123");

      // Directed to Google Chrome via Android Intent
      assert.ok(mockWindow.location.href.startsWith("intent://"), "Must set window.location.href to intent://");
      assert.ok(mockWindow.location.href.includes("package=com.android.chrome"), "Must target package=com.android.chrome");
      assert.ok(mockWindow.location.href.includes("imprimir-romaneio"), "Must target /imprimir-romaneio endpoint");
    } finally {
      globalThis.window = prevWin;
      globalThis.document = prevDoc;
      if (prevNav) {
        Object.defineProperty(globalThis, "navigator", prevNav);
      }
      globalThis.localStorage = prevStorage;
    }
  });

  it("app/imprimir-romaneio/page.tsx exists and is present", () => {
    const pagePath = path.join(ROOT_DIR, "app", "imprimir-romaneio", "page.tsx");
    assert.ok(fs.existsSync(pagePath), "app/imprimir-romaneio/page.tsx must exist");
    const code = fs.readFileSync(pagePath, "utf8");
    assert.ok(code.includes("window.print()"), "imprimir-romaneio/page.tsx must invoke window.print()");
    assert.ok(code.includes("routewise_print_html"), "imprimir-romaneio/page.tsx must read routewise_print_html");
  });
});
