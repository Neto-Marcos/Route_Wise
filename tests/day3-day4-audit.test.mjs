import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// ----------------------------------------------------------------------------
// Imports under test
// ----------------------------------------------------------------------------
import { parseNotfis } from "../lib/notfis-parser.ts";
import { parseSpreadsheet } from "../lib/spreadsheet-parser.ts";
import { generateRoutes } from "../lib/route-engine.ts";
import { compressDriverPhoto, uploadPhotoToStorage } from "../lib/driver-photo.ts";
import { enqueue, flushQueue, registerBackgroundSync, clearQueue, getQueueCount } from "../lib/offline.ts";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

describe("Day 3 & Day 4 Comprehensive Audit Test Suite", () => {

  // ==========================================================================
  // Day 3: Direct S3 Presigned Uploads & SW Background Sync
  // ==========================================================================
  describe("R1. Day 3: Direct S3 Presigned Uploads & Background Sync", () => {

    it("R1.1: app/api/upload/presign/route.ts code and contract generates 15-minute Presigned S3 URL", async () => {
      const presignRoutePath = path.join(ROOT_DIR, "app", "api", "upload", "presign", "route.ts");
      const presignCode = fs.readFileSync(presignRoutePath, "utf8");

      assert.ok(presignCode.includes("getSignedUrl"), "Must use @aws-sdk/s3-request-presigner getSignedUrl");
      assert.ok(presignCode.includes("PutObjectCommand"), "Must use S3 PutObjectCommand");
      assert.ok(presignCode.includes("expiresIn: 900"), "Presigned URL must expire in exactly 900 seconds (15 minutes)");
      assert.ok(presignCode.includes("directS3: true"), "Must return directS3: true when S3 credentials exist");
      assert.ok(presignCode.includes("directS3: false"), "Must return directS3: false when S3 credentials are omitted");
      assert.ok(presignCode.includes("/api/upload/file?key="), "Fallback must route to /api/upload/file");

      // Verify AWS S3 Request Presigner executes cleanly and produces a 15-minute signed URL
      const client = new S3Client({
        region: "sa-east-1",
        credentials: {
          accessKeyId: "MOCK_AUDIT_ACCESS_KEY_ID",
          secretAccessKey: "MOCK_AUDIT_SECRET_ACCESS_KEY_12345",
        },
      });

      const cmd = new PutObjectCommand({
        Bucket: "routewise-proofs",
        Key: "pod_photo/2026-09-13/test-presign.webp",
        ContentType: "image/webp",
      });

      const presignedUrl = await getSignedUrl(client, cmd, { expiresIn: 900 });
      assert.ok(typeof presignedUrl === "string", "Must return presigned URL string");
      assert.ok(presignedUrl.includes("X-Amz-Signature"), "Must contain AWS signature");
      assert.ok(presignedUrl.includes("X-Amz-Expires=900"), "URL query must explicitly include X-Amz-Expires=900");
    });

    it("R1.2: app/api/upload/presign/route.ts clean local fallback contract when credentials omitted", () => {
      const presignRoutePath = path.join(ROOT_DIR, "app", "api", "upload", "presign", "route.ts");
      const presignCode = fs.readFileSync(presignRoutePath, "utf8");

      assert.ok(presignCode.includes("if (!accessKeyId || !secretAccessKey)"), "Must check access key and secret");
      assert.ok(presignCode.includes("return null"), "Must return null client when credentials omitted");
      assert.ok(presignCode.includes("upload_objects"), "Must track object in upload_objects database");
    });

    it("R1.3: app/api/upload/file/route.ts implements fallback storage handler", () => {
      const uploadFilePath = path.join(ROOT_DIR, "app", "api", "upload", "file", "route.ts");
      assert.ok(fs.existsSync(uploadFilePath), "app/api/upload/file/route.ts must exist");
      const fileCode = fs.readFileSync(uploadFilePath, "utf8");

      assert.ok(fileCode.includes("upload_objects"), "Must store file in upload_objects table");
      assert.ok(fileCode.includes("file_data"), "Must store binary bytea data");
    });

    it("R1.4: public/sw.js defines background sync handler for 'rw-background-sync'", () => {
      const swPath = path.join(ROOT_DIR, "public", "sw.js");
      const swContent = fs.readFileSync(swPath, "utf8");

      assert.ok(swContent.includes("rw-background-sync"), "public/sw.js must reference rw-background-sync tag");
      assert.ok(swContent.includes("SYNC_OFFLINE_QUEUE"), "public/sw.js must post SYNC_OFFLINE_QUEUE message to clients");
      assert.ok(swContent.includes('self.addEventListener("sync"'), "public/sw.js must contain sync event listener");
    });

    it("R1.5: lib/offline.ts registers 'rw-background-sync' and handles SW message events", async () => {
      assert.strictEqual(typeof registerBackgroundSync, "function", "registerBackgroundSync must be exported");

      // In Node environment without window/serviceWorker, returns false safely without throwing
      const result = await registerBackgroundSync();
      assert.strictEqual(typeof result, "boolean");

      const offlineContent = fs.readFileSync(path.join(ROOT_DIR, "lib", "offline.ts"), "utf8");
      assert.ok(offlineContent.includes("rw-background-sync"), "offline.ts must reference rw-background-sync tag");
      assert.ok(offlineContent.includes("SYNC_OFFLINE_QUEUE"), "offline.ts must listen to SYNC_OFFLINE_QUEUE message");
    });

    it("R1.6: lib/driver-photo.ts uploadPhotoToStorage compresses photo to WebP and uploads", async () => {
      // Create a valid test photo using sharp
      const sharp = (await import("sharp")).default;
      const sampleJpeg = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .jpeg()
        .toBuffer();

      // Mock fetch for presign and uploadUrl
      const originalFetch = globalThis.fetch;
      let presignCalled = false;
      let uploadCalled = false;
      let uploadMethod = "";
      let uploadContentType = "";

      globalThis.fetch = async (url, opts = {}) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/upload/presign")) {
          presignCalled = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              directS3: true,
              uploadUrl: "https://routewise-proofs.s3.amazonaws.com/pod_photo/2026-09-13/test.webp?sig=123",
              objectKey: "pod_photo/2026-09-13/test.webp",
            }),
          };
        }
        if (urlStr.includes("s3.amazonaws.com")) {
          uploadCalled = true;
          uploadMethod = opts.method;
          uploadContentType = opts.headers?.["Content-Type"] || opts.headers?.["content-type"];
          return {
            ok: true,
            status: 200,
            text: async () => "",
          };
        }
        return originalFetch(url, opts);
      };

      try {
        const file = new File([sampleJpeg], "delivery-proof.jpg", { type: "image/jpeg" });
        const res = await uploadPhotoToStorage(file, "pod_photo");

        assert.strictEqual(presignCalled, true, "Presign API must be invoked");
        assert.strictEqual(uploadCalled, true, "Upload URL must be called");
        assert.strictEqual(uploadMethod, "PUT", "Direct upload must use HTTP PUT");
        assert.strictEqual(uploadContentType, "image/webp", "Uploaded payload must be image/webp");
        assert.strictEqual(res.objectKey, "pod_photo/2026-09-13/test.webp");
        assert.strictEqual(res.photo.format, "image/webp", "Photo result must be WebP");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("R1.7: app/api/upload/file/route.ts implements GET handler for local storage read retrieval", () => {
      const uploadFilePath = path.join(ROOT_DIR, "app", "api", "upload", "file", "route.ts");
      const fileCode = fs.readFileSync(uploadFilePath, "utf8");

      assert.ok(fileCode.includes("export async function GET"), "app/api/upload/file/route.ts must export GET handler");
      assert.ok(fileCode.includes("SELECT content_type, file_data FROM upload_objects"), "Must query upload_objects for file retrieval");
      assert.ok(fileCode.includes("Content-Type"), "Must set Content-Type header on retrieved binary");
    });

    it("R1.8: lib/driver-photo.ts uploadPhotoToStorage returns publicUrl and safely handles relative URLs in Node", async () => {
      const sharp = (await import("sharp")).default;
      const samplePng = await sharp({
        create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 255, b: 0 } },
      })
        .png()
        .toBuffer();

      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (url, opts = {}) => {
          const urlStr = String(url);
          if (urlStr.includes("/api/upload/presign")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                directS3: false,
                uploadUrl: "/api/upload/file?key=pod_photo%2F2026-09-13%2Ffallback.webp",
                objectKey: "pod_photo/2026-09-13/fallback.webp",
                publicUrl: "/api/uploads/local/pod_photo%2F2026-09-13%2Ffallback.webp",
              }),
            };
          }
          if (urlStr.includes("/api/upload/file")) {
            return {
              ok: true,
              status: 200,
              text: async () => "",
            };
          }
          return originalFetch(url, opts);
        };

        const file = new File([samplePng], "fallback-test.png", { type: "image/png" });
        const res = await uploadPhotoToStorage(file, "pod_photo");

        assert.strictEqual(res.directS3, false, "Must handle local fallback");
        assert.strictEqual(res.objectKey, "pod_photo/2026-09-13/fallback.webp");
        assert.ok(res.publicUrl?.includes("/api/uploads/local/"), "Must return valid publicUrl");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("R1.9: lib/offline.ts registers window 'online' event listener for immediate queue recovery", () => {
      const offlinePath = path.join(ROOT_DIR, "lib", "offline.ts");
      const offlineCode = fs.readFileSync(offlinePath, "utf8");

      assert.ok(
        offlineCode.includes('window.addEventListener("online"'),
        "lib/offline.ts must listen to 'online' event to auto-flush queue on reconnection across all browsers"
      );
    });

  });

  // ==========================================================================
  // Day 4: NOTFIS EDI 3.1/5.0 Parser & Mass Spreadsheet Support
  // ==========================================================================
  describe("R2. Day 4: NOTFIS EDI 3.1/5.0 Parser & Mass Routing", () => {

    it("R2.1: lib/notfis-parser.ts parses Proceda NOTFIS positional text file and extracts 44-digit DANFE key", () => {
      const danfeKey1 = "35260912345678000195550010000012341000012345";
      const danfeKey2 = "25260998765432000188550010000056781000056789";

      // Layout Proceda NOTFIS com registros 000, 310, 311, 312, 313
      const notfisText = [
        "000DISTRIBUIDORA EXEMPLO S/A          202609131000NOTFIS001234",
        "310TRANSPORTADORA ROTA RAPIDA LTDA   01234567000190",
        "311EMBARCADOR NACIONAL LTDA          98765432000110",
        `312000001234 1 20260913VENDA MERCADORIA    00052050 000003500 00020 00000001525000                   CAMPINA GRANDE                    MERCADO CENTRAL DA PARAIBA LTDA     ${danfeKey1}`,
        "313RUA MACIEL PINHEIRO, 100                 CENTRO                        CAMPINA GRANDE                    PB58400000",
        `312000005678 1 20260913VENDA MERCADORIA    00034000 000002100 00015 00000000840000                   JOAO PESSOA                       SUPERMERCADO TROPICAL LTDA          ${danfeKey2}`,
        "313AV EPITACIO PESSOA, 500                  TAMBAU                        JOAO PESSOA                       PB58038000",
      ].join("\n");

      const result = parseNotfis(notfisText);

      assert.strictEqual(result.invoices.length, 2, "Must parse exactly 2 invoices");
      assert.strictEqual(result.orders.length, 2, "Must produce 2 routing orders");

      // Verificação da NF 1
      const inv1 = result.invoices[0];
      assert.strictEqual(inv1.invoiceNumber, "000001234");
      assert.strictEqual(inv1.danfeKey, danfeKey1, "Must extract 44-digit DANFE access key");
      assert.strictEqual(inv1.city, "CAMPINA GRANDE");
      assert.strictEqual(inv1.state, "PB");
      assert.strictEqual(inv1.recipientName, "MERCADO CENTRAL DA PARAIBA LTDA");
      assert.strictEqual(inv1.weightKg, 520.5);
      assert.strictEqual(inv1.volumeM3, 3.5);
      assert.strictEqual(inv1.boxes, 20);
      assert.strictEqual(inv1.totalValue, 15250.0);

      // Verificação da NF 2
      const inv2 = result.invoices[1];
      assert.strictEqual(inv2.invoiceNumber, "000005678");
      assert.strictEqual(inv2.danfeKey, danfeKey2);
      assert.strictEqual(inv2.city, "JOAO PESSOA");
      assert.strictEqual(inv2.state, "PB");
      assert.strictEqual(inv2.weightKg, 340.0);
      assert.strictEqual(inv2.volumeM3, 2.1);
      assert.strictEqual(inv2.boxes, 15);
      assert.strictEqual(inv2.totalValue, 8400.0);

      // Verificação dos totais estatísticos
      assert.strictEqual(result.stats.totalInvoices, 2);
      assert.strictEqual(result.stats.totalVolumeM3, 5.6);
      assert.strictEqual(result.stats.totalWeightKg, 860.5);
      assert.strictEqual(result.stats.totalValue, 23650.0);
    });

    it("R2.2: lib/notfis-parser.ts generates compatible OrderRow items ready for LIFO routing", () => {
      const danfeKey = "35260900000000000100550010000099991000099999";
      const notfisText = [
        "000CABECALHO",
        `312000009999 1 20260913VENDA                00012000 000001200 00005 00000000350000                   PATOS                             LOJA EXEMPLO PATOS                  ${danfeKey}`,
        "313RUA SOLON DE LUCENA 50                   CENTRO                        PATOS                             PB58700000",
      ].join("\n");

      const result = parseNotfis(notfisText);
      assert.strictEqual(result.orders.length, 1);

      const order = result.orders[0];
      assert.strictEqual(order.city, "PATOS");
      assert.strictEqual(order.client, "LOJA EXEMPLO PATOS");
      assert.strictEqual(order.clientName, "LOJA EXEMPLO PATOS");
      assert.strictEqual(order.orderId, "000009999");
      assert.strictEqual(order.volumeM3, 1.2);
      assert.strictEqual(order.weightKg, 120.0);
      assert.strictEqual(order.boxes, 5);
      assert.strictEqual(order.uf, "PB");
      assert.strictEqual(order.extra.danfeKey, danfeKey);
      assert.strictEqual(order.extra.formato, "NOTFIS EDI");
    });

    it("R2.3: app/api/routerizador/parse/route.ts verifies file extension and routing support", () => {
      const parseRoutePath = path.join(ROOT_DIR, "app", "api", "routerizador", "parse", "route.ts");
      const parseCode = fs.readFileSync(parseRoutePath, "utf8");

      assert.ok(parseCode.includes(".txt") || parseCode.includes("(txt|not|edi)"), "Must support NOTFIS extensions");
      assert.ok(parseCode.includes("parseNotfis"), "Must call parseNotfis for EDI files");
      assert.ok(parseCode.includes("parseSpreadsheet"), "Must call parseSpreadsheet for Excel/CSV");
      assert.ok(parseCode.includes("isNotfis: true"), "Must flag NOTFIS responses with isNotfis: true");
    });

    it("R2.4: lib/route-engine.ts processes parsed NOTFIS orders into LIFO routes with capacity limits", () => {
      const orders = [
        {
          orderId: "NF-001",
          client: "Cliente Campina Grande",
          clientName: "Cliente Campina Grande",
          city: "Campina Grande",
          volumeM3: 10.0,
          weightKg: 2000,
          boxes: 50,
          extra: { danfeKey: "11111111111111111111111111111111111111111111" },
        },
        {
          orderId: "NF-002",
          client: "Cliente Patos",
          clientName: "Cliente Patos",
          city: "Patos",
          volumeM3: 12.0,
          weightKg: 2500,
          boxes: 60,
          extra: { danfeKey: "22222222222222222222222222222222222222222222" },
        },
      ];

      const config = {
        maxVolumeM3: 30,
        maxWeightKg: 10000,
        clusterRadiusKm: 150,
        routeDate: "2026-09-15",
        originName: "CD Campina Grande",
        originLat: -7.2306,
        originLng: -35.8811,
      };

      const result = generateRoutes(orders, config);
      assert.ok(result.routes.length >= 1, "Must generate at least 1 route");

      for (const route of result.routes) {
        // Capacidade estrita respeitada
        assert.ok(route.totalVolumeM3 <= config.maxVolumeM3, "Volume must not exceed vehicle capacity");
        assert.ok(route.totalWeightKg <= config.maxWeightKg, "Weight must not exceed vehicle capacity");

        // Ordem LIFO: cada parada possui loadingSequence inversa da position
        for (const stop of route.stops) {
          assert.ok(Number.isInteger(stop.loadingSequence), "loadingSequence must be integer");
          assert.strictEqual(
            stop.loadingSequence,
            route.stops.length - stop.position + 1,
            "loadingSequence must follow LIFO: last delivery = sequence 1"
          );
        }
      }
    });

    it("R2.5: components/roteirizador-page.tsx UI supports drag and drop of NOTFIS (.txt/.not/.edi) and LIFO display", () => {
      const pagePath = path.join(ROOT_DIR, "components", "roteirizador-page.tsx");
      const pageContent = fs.readFileSync(pagePath, "utf8");

      assert.ok(
        pageContent.includes(".not") && pageContent.includes(".edi") && pageContent.includes(".txt"),
        "File input accept attribute must include .txt, .not, .edi"
      );
      assert.ok(
        pageContent.includes("onDrop"),
        "UI must implement Drag & Drop onDrop handler"
      );
      assert.ok(
        pageContent.includes("LIFO") || pageContent.includes("loadingSequence"),
        "UI must display LIFO loading sequence"
      );
    });

    it("R2.6: lib/notfis-parser.ts handles 5-digit weight and unpadded numbers WITHOUT DANFE key collision or numeric corruption", () => {
      const danfeKey = "35260912345678000195550010000012341000012345";
      // Weight with 5 digits without leading zeros: 12345 (= 123.45 kg)
      const line = `312000001234 1 20260913VENDA MERCADORIA    12345    000003500 00020 00000001525000                   CAMPINA GRANDE                    MERCADO CENTRAL DA PARAIBA LTDA     ${danfeKey}`;

      const res = parseNotfis(line);
      assert.strictEqual(res.invoices.length, 1);
      const inv = res.invoices[0];

      // Must NOT match inside the DANFE key (which would produce 3.5 million kg!)
      assert.strictEqual(inv.weightKg, 123.45, "Weight must be 123.45 kg, NOT corrupted by DANFE key digits");
      assert.strictEqual(inv.volumeM3, 3.5, "Volume must be 3.5 m³");
      assert.strictEqual(inv.boxes, 20, "Boxes must be 20");
      assert.strictEqual(inv.totalValue, 15250.0, "Total value must be 15,250.00");
      assert.strictEqual(inv.danfeKey, danfeKey, "DANFE key must match");
      assert.strictEqual(inv.city, "CAMPINA GRANDE");
    });

    it("R2.7: lib/notfis-parser.ts correctly extracts Proceda 3.1 invoice number when Romaneio field is blank", () => {
      const danfeKey = "25260998765432000188550010000056781000056789";
      // Proceda 3.1 layout: positions 3..10 is Romaneio (blank 8 spaces), positions 11..19 is Invoice Number (00005678)
      const line = `312        00005678  120260913VENDA MERCADORIA    00034000 000002100 00015 00000000840000                   JOAO PESSOA                       SUPERMERCADO TROPICAL LTDA          ${danfeKey}`;

      const res = parseNotfis(line);
      assert.strictEqual(res.invoices.length, 1);
      assert.strictEqual(res.invoices[0].invoiceNumber, "00005678", "Must extract 00005678, NOT '00'");
      assert.strictEqual(res.orders[0].orderId, "00005678");
    });

    it("R2.8: lib/notfis-parser.ts handles multi-invoice files with record 311 headers and record 319 trailers across conjoined shipments", () => {
      const key1 = "35260911111111000195550010000000011000000001";
      const key2 = "35260922222222000195550010000000021000000002";
      const key3 = "35260933333333000195550010000000031000000003";

      const multiText = [
        "000DISTRIBUIDORA NORDESTE            202609131200NOTFIS00001",
        "310TRANSPORTES BRASIL LTDA",
        "311FORNECEDOR ALFA SA                11111111000195",
        `312000000001 1 20260913VENDA                00020000 000001000 00010 00000000500000                   RECIFE                            CLIENTE ALFA                        ${key1}`,
        "313AV BOA VIAGEM 100                        BOA VIAGEM                    RECIFE                            PE51000000",
        "31900000000100000000500000",
        "000DISTRIBUIDORA NORDESTE            202609131200NOTFIS00002",
        "311FORNECEDOR BETA SA                22222222000195",
        `312000000002 1 20260913VENDA                00030000 000001500 00015 00000000750000                   CABEDELO                          CLIENTE BETA                        ${key2}`,
        "313RUA DO PORTO 200                         CENTRO                        CABEDELO                          PB58100000",
        "31900000000200000000750000",
        `312000000003 1 20260913VENDA                00015000 000000800 00008 00000000300000                   BAYEUX                            CLIENTE GAMA                        ${key3}`,
        "313RUA DA LIBERDADE 50                      CENTRO                        BAYEUX                            PB58306000",
        "31900000000300000000300000",
      ].join("\n");

      const res = parseNotfis(multiText);
      assert.strictEqual(res.invoices.length, 3, "Must parse all 3 invoices across conjoined shipments");
      assert.strictEqual(res.orders.length, 3);
      assert.strictEqual(res.invoices[0].invoiceNumber, "000000001");
      assert.strictEqual(res.invoices[1].invoiceNumber, "000000002");
      assert.strictEqual(res.invoices[2].invoiceNumber, "000000003");
      assert.strictEqual(res.invoices[0].state, "PE");
      assert.strictEqual(res.invoices[1].state, "PB");
      assert.strictEqual(res.invoices[2].state, "PB");
    });

    it("R2.9: app/api/routerizador/parse/route.ts protects .csv files with MIME text/plain and allows dual NOTFIS/CSV format fallback", () => {
      const parseRoutePath = path.join(ROOT_DIR, "app", "api", "routerizador", "parse", "route.ts");
      const parseCode = fs.readFileSync(parseRoutePath, "utf8");

      assert.ok(
        parseCode.includes("isSpreadsheetExt"),
        "Must verify spreadsheet extension to avoid misclassifying CSV with MIME text/plain as NOTFIS"
      );
      assert.ok(
        parseCode.includes("parseNotfis") && parseCode.includes("parseSpreadsheet"),
        "Must support both NOTFIS and spreadsheet parsers"
      );
      assert.ok(
        parseCode.includes("isNotfis: true") && parseCode.includes("isNotfis: false"),
        "Must return isNotfis boolean flag appropriately"
      );
    });

    it("R2.10: lib/notfis-parser.ts accurately parses numbers with decimal periods without 100x multiplication corruption", () => {
      const danfeKey = "35260912345678000195550010000012341000012345";
      // Weight with explicit period: 123.45, Volume: 3.50, Boxes: 20, Value: 50.00
      const line = `312000001234 1 20260913VENDA MERCADORIA    123.45    3.50    20    50.00                   CAMPINA GRANDE                    MERCADO CENTRAL DA PARAIBA LTDA     ${danfeKey}`;

      const res = parseNotfis(line);
      assert.strictEqual(res.invoices.length, 1);
      const inv = res.invoices[0];

      assert.strictEqual(inv.weightKg, 123.45, "Weight must be 123.45, NOT 12345");
      assert.strictEqual(inv.volumeM3, 3.5, "Volume must be 3.50, NOT 350");
      assert.strictEqual(inv.boxes, 20);
      assert.strictEqual(inv.totalValue, 50.0, "Total value must be 50.00, NOT 5000");
    });

    it("R2.11: lib/notfis-parser.ts strips UTF-8 BOM and seamlessly handles CRLF, LF, and CR line endings", () => {
      const danfeKey = "35260911111111000195550010000000011000000001";
      // Starts with UTF-8 BOM (\uFEFF) and uses mixed CRLF / CR / LF line endings
      const notfisWithBom =
        "\uFEFF000DISTRIBUIDORA BOM TESTE            202609131200NOTFIS00001\r\n" +
        "310TRANSPORTES BOM\r" +
        `312000000001 1 20260913VENDA                00020000 000001000 00010 00000000500000                   RECIFE                            CLIENTE BOM                         ${danfeKey}\n` +
        "313AV BOA VIAGEM 100                        BOA VIAGEM                    RECIFE                            PE51000000\r\n" +
        "31900000000100000000500000";

      const res = parseNotfis(notfisWithBom);
      assert.strictEqual(res.invoices.length, 1, "Must parse invoice even with UTF-8 BOM and mixed line endings");
      assert.strictEqual(res.invoices[0].invoiceNumber, "000000001");
      assert.strictEqual(res.invoices[0].danfeKey, danfeKey);
      assert.strictEqual(res.invoices[0].city, "RECIFE");
      assert.strictEqual(res.header.senderName?.includes("DISTRIBUIDORA BOM TESTE"), true, "Header record 000 must be parsed");
    });

    it("R2.12: app/api/upload/presign/route.ts generates correct regional and custom endpoint URLs", () => {
      const presignPath = path.join(ROOT_DIR, "app", "api", "upload", "presign", "route.ts");
      const presignCode = fs.readFileSync(presignPath, "utf8");

      assert.ok(presignCode.includes("s3Region"), "Must inspect S3 region");
      assert.ok(presignCode.includes("s3Endpoint"), "Must inspect custom S3 endpoint");
      assert.ok(presignCode.includes("${s3Region}.amazonaws.com"), "Must support non-us-east-1 regional endpoints (e.g. sa-east-1)");
    });

    it("R2.13: lib/offline.ts prunes invalid URLs and increments retry attempts to prevent queue poisoning", async () => {
      await clearQueue();

      // Enqueue an operation with a malformed URL (poison pill) followed by a valid operation
      await enqueue({
        url: "not-a-valid-url",
        body: { bad: true },
      });
      await enqueue({
        url: "/api/routes/valid-after-bad",
        body: { ok: true },
      });

      const origFetch = globalThis.fetch;
      let validFetched = false;

      globalThis.fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("valid-after-bad")) {
          validFetched = true;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        // Malformed URL throws TypeError: Invalid URL as real fetch would
        throw new TypeError("Failed to parse URL: Invalid URL");
      };

      try {
        const processed = await flushQueue();
        assert.strictEqual(validFetched, true, "Valid operation must be processed after pruning poison pill");
        assert.strictEqual(processed, 1, "1 valid operation completed");
        assert.strictEqual(await getQueueCount(), 0, "Queue must be drained without getting stuck");
      } finally {
        globalThis.fetch = origFetch;
        await clearQueue();
      }
    });

    it("R2.14: components/roteirizador-page.tsx resets input value to allow re-selection and disables pointer events on drop content", () => {
      const pagePath = path.join(ROOT_DIR, "components", "roteirizador-page.tsx");
      const pageCode = fs.readFileSync(pagePath, "utf8");

      assert.ok(pageCode.includes('e.target.value = ""'), "Must reset file input value to allow re-uploading same file");
      assert.ok(pageCode.includes("pointerEvents: \"none\""), "Must disable pointer events on inner drop zone to prevent drag flicker");
    });

    it("R2.15: lib/notfis-parser.ts accurately parses records with numeric CFOP without confusing CFOP for weight or corrupting city", () => {
      const danfeKey = "35260912345678000195550010000012341000012345";
      // Record 312 with numeric CFOP 5102 before metrics:
      const line = `312000001234 1 20260913 5102       00052050 000003500 00020 00000001525000                   CAMPINA GRANDE                    MERCADO CENTRAL DA PARAIBA LTDA     ${danfeKey}`;

      const res = parseNotfis(line);
      assert.strictEqual(res.invoices.length, 1);
      const inv = res.invoices[0];

      // Must NOT take 5102 as weight!
      assert.strictEqual(inv.weightKg, 520.50, "Weight must be 520.50 kg, NOT 1.02 (from CFOP 5102)");
      assert.strictEqual(inv.volumeM3, 3.50, "Volume must be 3.50 m³");
      assert.strictEqual(inv.boxes, 20, "Boxes must be 20");
      assert.strictEqual(inv.totalValue, 15250.00, "Total value must be 15,250.00");
      assert.strictEqual(inv.city, "CAMPINA GRANDE", "City must be CAMPINA GRANDE, NOT numeric totalValue");
      assert.strictEqual(inv.recipientName, "MERCADO CENTRAL DA PARAIBA LTDA");
    });

    it("R2.16: lib/notfis-parser.ts preserves full multi-part recipient names when company names contain spaces", () => {
      const danfeKey = "35260933333333000195550010000000031000000003";
      const line = `312000000003 1 20260913 5405 520.50 3.50 20 15250.00                   RECIFE                            LOJAS AMERICANAS  FILIAL NORDESTE 02     ${danfeKey}`;

      const res = parseNotfis(line);
      assert.strictEqual(res.invoices.length, 1);
      const inv = res.invoices[0];

      assert.strictEqual(inv.city, "RECIFE");
      assert.ok(
        inv.recipientName.includes("LOJAS AMERICANAS") && inv.recipientName.includes("FILIAL NORDESTE 02"),
        `Recipient name must preserve all multi-part tokens (got: ${inv.recipientName})`
      );
    });

    it("R2.17: lib/notfis-parser.ts parses indented lines and preserves 3 decimal places in volume statistics", () => {
      const danfeKey = "35260911111111000195550010000000011000000001";
      // Line with leading indentation spaces:
      const indentedText = [
        "  000EMBARCADOR INDENTADO",
        `  312000000001 1 20260913VENDA 00000500 000000005 00001 00000000050000                   PATOS                             LOJA PATOS                          ${danfeKey}`,
        "  313RUA A 100 - PATOS PB",
      ].join("\n");

      const res = parseNotfis(indentedText);
      assert.strictEqual(res.invoices.length, 1, "Must parse line even with leading indentation");
      assert.strictEqual(res.invoices[0].invoiceNumber, "000000001");
      assert.strictEqual(res.invoices[0].volumeM3, 0.005, "Must parse small cubic volume (0.005 m³)");
      assert.strictEqual(res.stats.totalVolumeM3, 0.005, "Stats must not round 0.005 m³ to 0.00");
    });

    it("R2.18: public/sw.js implements flushQueueFromSW fallback to drain IndexedDB when no window is active", () => {
      const swPath = path.join(ROOT_DIR, "public", "sw.js");
      const swCode = fs.readFileSync(swPath, "utf8");

      assert.ok(swCode.includes("flushQueueFromSW"), "SW must define flushQueueFromSW for background drain");
      assert.ok(swCode.includes("includeUncontrolled: true"), "SW must find uncontrolled client windows");
      assert.ok(swCode.includes("routewise-offline"), "SW must access 'routewise-offline' IndexedDB");
    });

    it("R2.19: app/api/upload/presign/route.ts sanitizes kind and extension against directory traversal", () => {
      const presignPath = path.join(ROOT_DIR, "app", "api", "upload", "presign", "route.ts");
      const presignCode = fs.readFileSync(presignPath, "utf8");

      assert.ok(presignCode.includes("safeKind"), "Presign route must validate safeKind");
      assert.ok(presignCode.includes("replace(/[^a-zA-Z0-9]/g"), "Presign route must strip illegal characters from ext");
      assert.ok(presignCode.includes("url: uploadUrl"), "Presign route must provide compatibility aliases");
    });

  });

});
