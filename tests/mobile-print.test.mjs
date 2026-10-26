import test, { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

describe("Mobile Print Implementation", () => {
  it("does not call window.open or throw popup blocked errors on mobile", () => {
    const printDocPath = path.join(ROOT_DIR, "lib", "print-document.ts");
    const code = fs.readFileSync(printDocPath, "utf8");

    // Remove comments to check executable code
    const executableCode = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

    // Check that window.open is completely removed from print-document.ts executable code
    assert.strictEqual(
      executableCode.includes("window.open"),
      false,
      "printElement must NOT call window.open (causes popup blocker failures and breaks PWA standalone mode)"
    );

    // Check that popup error is removed
    assert.strictEqual(
      code.includes("Permita abrir novas abas"),
      false,
      "printElement must NOT throw popup permission errors"
    );

    // Check that routewise-print-portal is used
    assert.ok(
      code.includes("routewise-print-portal"),
      "printElement must create/use #routewise-print-portal"
    );

    // Check that native window.print is called
    assert.ok(
      code.includes("window.print()"),
      "printElement must invoke native window.print()"
    );
  });

  it("includes print portal styling in globals.css", () => {
    const cssPath = path.join(ROOT_DIR, "app", "globals.css");
    const css = fs.readFileSync(cssPath, "utf8");

    assert.ok(
      css.includes("#routewise-print-portal"),
      "app/globals.css must define styles for #routewise-print-portal"
    );
    assert.ok(
      css.includes("routewise-portal-active"),
      "app/globals.css must define print visibility rules for body.routewise-portal-active"
    );
  });

  it("simulates printElement execution lifecycle in DOM environment", async () => {
    // Minimal DOM environment simulation
    const listeners = new Map();
    let printCalled = false;
    let originalTitle = "Criar Rota - App";

    const bodyChildren = [];
    const bodyClassList = new Set();

    const mockSource = {
      id: "printable-report",
      className: "printable-report-paper",
      querySelectorAll: () => [],
      cloneNode: () => ({
        id: "",
        className: "printable-report-paper",
        querySelectorAll: () => [],
      }),
    };

    const mockDocument = {
      title: originalTitle,
      body: {
        classList: {
          add: (cls) => bodyClassList.add(cls),
          remove: (cls) => bodyClassList.delete(cls),
          contains: (cls) => bodyClassList.has(cls),
        },
        appendChild: (el) => bodyChildren.push(el),
      },
      getElementById: (id) => (id === "printable-report" ? mockSource : null),
      querySelectorAll: (sel) => {
        if (sel.includes("routewise-print-portal")) {
          return bodyChildren.filter((el) => el.id === "routewise-print-portal");
        }
        return [];
      },
      createElement: (tag) => {
        const el = {
          tagName: tag.toUpperCase(),
          id: "",
          children: [],
          attributes: {},
          setAttribute: (k, v) => { el.attributes[k] = v; },
          appendChild: (child) => el.children.push(child),
          querySelectorAll: () => [],
          remove: () => {
            const idx = bodyChildren.indexOf(el);
            if (idx !== -1) bodyChildren.splice(idx, 1);
          },
        };
        return el;
      },
    };

    const mockWindow = {
      document: mockDocument,
      title: originalTitle,
      addEventListener: (evt, fn) => {
        if (!listeners.has(evt)) listeners.set(evt, []);
        listeners.get(evt).push(fn);
      },
      removeEventListener: (evt, fn) => {
        if (!listeners.has(evt)) return;
        const list = listeners.get(evt).filter((cb) => cb !== fn);
        listeners.set(evt, list);
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      print: () => {
        printCalled = true;
      },
    };

    // Dynamically test the implementation logic
    const { printElement } = await import(`../lib/print-document.ts?t=${Date.now()}`);

    // Set globals for test
    const globalDoc = globalThis.document;
    const globalWin = globalThis.window;
    globalThis.document = mockDocument;
    globalThis.window = mockWindow;

    try {
      // 1. Missing element test
      await assert.rejects(
        () => printElement("non-existent-id", "Relatório"),
        /Documento de impressão não encontrado/
      );

      // 2. Successful print lifecycle test
      await printElement("printable-report", "Relatório - Rota Norte");

      assert.strictEqual(printCalled, true, "window.print must have been called");
      assert.strictEqual(mockDocument.title, "Relatório - Rota Norte", "Document title must match print title");
      assert.strictEqual(bodyClassList.has("routewise-portal-active"), true, "Body must have active portal class");
      assert.strictEqual(
        bodyChildren.some((el) => el.id === "routewise-print-portal"),
        true,
        "Portal must be mounted in body"
      );

      // 3. Simulate afterprint event
      const afterPrintHandlers = listeners.get("afterprint") || [];
      for (const handler of afterPrintHandlers) {
        handler();
      }

      assert.strictEqual(bodyClassList.has("routewise-portal-active"), false, "Body class must be cleared after print");
      assert.strictEqual(mockDocument.title, originalTitle, "Original title must be restored after print");
      assert.strictEqual(
        bodyChildren.some((el) => el.id === "routewise-print-portal"),
        false,
        "Portal element must be removed from body after print"
      );
    } finally {
      globalThis.document = globalDoc;
      globalThis.window = globalWin;
    }
  });
});
