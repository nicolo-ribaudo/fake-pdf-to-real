import puppeteer from "puppeteer";
import { PDFDocument, asPDFNumber, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import DOMMatrix from "@thednp/dommatrix";

import * as browserUtils from "./browser.js";

export class Converter {
  #browserP;

  /** @type {import("puppeteer").Page} */
  #page = null;

  #processing = false;

  #fontFaces = new Map();

  static TRANSPARENT_TEXT = Symbol();
  static VISIBLE_TEXT = Symbol();

  constructor() {
    this.#browserP = puppeteer.launch();
  }

  async open(url) {
    if (this.#processing) throw new Error();
    this.#processing = true;

    try {
      this.#page ??= await this.#browserP.then((browser) => browser.newPage());
      await this.#page.goto(url, { waitUntil: "networkidle2" });

      this.#fontFaces.clear();
    } catch {
      await this.#page?.close();
      this.#page = null;
    } finally {
      this.#processing = false;
    }
  }

  async convertToPdf(mode = Converter.TRANSPARENT_TEXT) {
    if (this.#processing) throw new Error();
    this.#processing = true;

    try {
      console.error("Analyzing file...");
      const pages = await this.#page.evaluate(browserUtils.extractPages);
      if (!pages) return null;

      console.error(`Converting ${pages.length} pages...`);

      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);

      await Promise.all(
        pages.map((page) => {
          const pdfPage = pdf.addPage([page.width, page.height]);
          return this.#processPage(mode, pdf, pdfPage, page);
        })
      );

      console.error("\nGenerating PDF file...");

      return pdf.save();
    } finally {
      this.#processing = false;
    }
  }

  /**
   * @param {*} mode
   * @param {import("pdf-lib").PDFDocument} pdf
   * @param {import("pdf-lib").PDFPage} pdfPage
   * @param {Object} page
   * @param {[number, number]} size
   */
  async #processPage(mode, pdf, pdfPage, page) {
    for (const image of page.images) {
      const pdfImg = await pdf.embedPng(image.src);
      pdfPage.drawImage(pdfImg, {
        width: image.width,
        height: image.height,
        x: image.left,
        y: image.bottom,
      });
    }

    for (const text of page.text) {
      const font = await this.#getFont(pdf, text.font);

      pdfPage.drawText(text.text, {
        font,
        x: text.left,
        y: text.bottom,
        size: text.size,
        opacity: text.opacity,
        color:
          text.color == null
            ? undefined
            : rgb(...text.color.map((c) => c / 255)),
      });

      if (text.transform) {
        const { operators } = pdfPage.contentStream;
        for (let i = operators.length - 1; i >= 0; i--) {
          if (operators[i].name === "q") {
            break; // PushGraphcsState
          }
          if (operators[i].name === "Tm") {
            const matrix = new DOMMatrix(
              operators[i].args.map((n) => n.numberValue)
            ).multiply(new DOMMatrix(text.transform));
            operators[i].args = [
              matrix.a,
              matrix.b,
              matrix.c,
              matrix.d,
              matrix.e,
              matrix.f,
            ].map(asPDFNumber);
            break;
          }
        }
      }
    }

    process.stderr.write(".");
  }

  /**
   * @param {import("pdf-lib").PDFDocument} pdf
   * @param {string} fontFamily
   */
  async #getFont(pdf, fontFamily) {
    if (this.#fontFaces.has(fontFamily)) {
      return this.#fontFaces.get(fontFamily);
    }

    const promise = this.#page
      .evaluate(browserUtils.extractFont, fontFamily)
      .then((src) => {
        if (!src || !src.startsWith("url("))
          throw new Error(`Cannot extract font ${fontFamily} with src ${src}`);
        src = src.slice("url(".length, -")".length);
        if (src.startsWith('"') || src.startsWith("'")) src = src.slice(1, -1);

        return pdf.embedFont(src);
      });
    this.#fontFaces.set(fontFamily, promise);
    return promise;
  }

  async close() {
    await this.#page?.close();
    await this.#browserP.then((browser) => browser.close());
  }

  [Symbol.asyncDispose]() {
    return this.close();
  }
}
