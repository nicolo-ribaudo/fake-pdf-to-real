import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer";
import { parse } from "node-html-parser";
import { PDFDocument,  } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export class Converter {
  #browserP;

  /** @type {import("puppeteer").Page} */
  #page = null;

  /** @type {import("node-html-parser").HTMLElement} */
  #dom = null;

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
      this.#page.goto(url);

      this.#dom = parse(await readFile(url, "utf8"));

      this.#fontFaces.clear();
    } catch {
      await this.#page?.close();
      this.#page = null;
      this.#dom = null;
    } finally {
      this.#processing = false;
    }
  }

  looksLikePDF() {
    if (this.#processing) throw new Error();

    const container = this.#dom.getElementById("page-container");
    return !!container && !!container.querySelector("> .page");
  }

  async convertToPdf(mode = Converter.TRANSPARENT_TEXT) {
    if (this.#processing) throw new Error();
    this.#processing = true;

    try {
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);

      const promises = [];

      const pages = this.#dom.querySelectorAll("#page-container > .page");
      for (const domPage of pages) {
        const size = await this.#getElementSize(`#${domPage.id}`);
        if (size) {
          const pdfPage = pdf.addPage(size);
          promises.push(this.#processPage(mode, pdf, pdfPage, domPage, size));
        }
      }

      await Promise.all(promises);

      return pdf.save();
    } finally {
      this.#processing = false;
    }
  }

  /**
   * @param {*} mode
   * @param {import("pdf-lib").PDFDocument} pdf
   * @param {import("pdf-lib").PDFPage} pdfPage
   * @param {import("node-html-parser").HTMLElement} domPage
   * @param {[number, number]} size
   */
  async #processPage(mode, pdf, pdfPage, domPage, size) {
    const domImg = domPage.querySelector("> .img");
    if (domImg) {
      const PREFIX = "data:image/png;base64,";
      const domImgSrc = domImg.getAttribute("src");
      if (!domImgSrc.startsWith(PREFIX)) {
        throw new Error("Unsupported image format");
      }

      const pdfImg = await pdf.embedPng(domImgSrc);
      pdfPage.drawImage(pdfImg, { width: size[0], height: size[1] });
    }

    const domText = domPage.querySelectorAll("> .txt span");
    for (const [index, domSpan] of domText.entries()) {
      const element = await this.#page
        .evaluateHandle(
          (selector) => document.querySelector(selector),
          `#${domPage.id} > .txt span:nth-of-type(${index + 1})`
        )
        .then((h) => h.asElement());
      if (!element) continue;
      const [font, data] = await Promise.all([
        this.#getElementFont(pdf, element),
        this.#getTextElementData(element, size[1]),
      ]);

      pdfPage.drawText(domSpan.textContent, {
        font,
        x: data.x,
        y: data.y,
        size: data.size,
        opacity: 0,
      });
    }
    process.stderr.write(".");
  }

  #getElementSize(selector) {
    return this.#page.evaluate((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      if (!rect) return null;
      return [rect.width, rect.height];
    }, selector);
  }

  #getTextElementData(elementHandle, height) {
    return this.#page.evaluate((element, height) => {
      const style = getComputedStyle(element);

      const span = document.createElement("span");
      span.setAttribute("style", "font-size:0");
      span.innerText = "A";
      element.append(span);
      const baseline = span.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom;
      span.remove();

      return {
        x: parseFloat(style.left),
        y: height - parseFloat(style.top) - parseFloat(style.fontSize) - baseline,
        size: parseFloat(style.fontSize),
      };
    }, elementHandle, height);
  }

  /**
   * @param {import("pdf-lib").PDFDocument} pdf
   * @param {string} selector
   * @returns {Promise<import("pdf-lib").PDFFont>}
   */
  async #getElementFont(pdf, elementHandle) {
    const fontFamily = await this.#page.evaluate((element) => {
      return getComputedStyle(element).fontFamily;
    }, elementHandle);

    if (this.#fontFaces.has(fontFamily)) {
      return this.#fontFaces.get(fontFamily);
    }

    const promise = new Promise(async (resolve, reject) => {
      let src = await this.#page.evaluate((fontFamily) => {
        for (const styleSheet of document.styleSheets) {
          for (const rule of styleSheet.rules) {
            if (
              rule instanceof CSSFontFaceRule &&
              rule.style.getPropertyValue("font-family") === fontFamily
            ) {
              return rule.style.getPropertyValue("src");
            }
          }
        }
        return null;
      }, fontFamily);

      if (!src || !src.startsWith("url("))
        throw new Error("Cannot extract font");
      src = src.slice("url(".length, -")".length);
      if (src.startsWith('"') || src.startsWith("'")) src = src.slice(1, -1);

      resolve(pdf.embedFont(src));
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
