import { PDFDocument, asPDFNumber, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const pause = () => new Promise(resolve => setTimeout(resolve, 0));;

export async function convertToPdf($container, onProgress = console.info) {
  onProgress("Analyzing file...");
  await pause();
  const pages = extractPages($container);
  if (!pages) return null;

  onProgress(`Converting ${pages.length} pages...`);
  await pause();

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const pdfFontsPromises = new Map();
  const getFont = async (fontFamily) => {
    let fontP = pdfFontsPromises.get(fontFamily);
    if (!fontP) {
      fontP = pdf.embedFont(extractFontURL($container, fontFamily));
      pdfFontsPromises.set(fontFamily, fontP);
    }
    return fontP;
  }

  let remaining = pages.length;
  await Promise.all(
    pages.map(async (page, i) => {
      await pause();
      const pdfPage = pdf.addPage([page.width, page.height]);
      await processPage(pdf, pdfPage, page, getFont);
      onProgress(`Page ${String(i + 1).padStart(3, " ")} converted (${--remaining} remaining).`);
      await pause();
    })
  );

  await pause();
  onProgress("Generating PDF file...");
  await pause();

  const result = await pdf.save();

  onProgress("Done");

  return result;
}

function extractPages($container) {
  const images = $container.querySelectorAll("img[src^='data:']");

  const nodes = new Map();

  const TYPE_IMAGE = 0,
    TYPE_CONTAINER = 1;

  const createNode = (type, el, children) => {
    const node = {
      type,
      element: el,
      children,
      imagesCount: 0,
    };
    nodes.set(el, node);
    return node;
  };

  let root = createNode(TYPE_CONTAINER, $container, []);
  nodes.set($container, root);

  for (const image of images) {
    let node = createNode(TYPE_IMAGE, image, []);
    let el = image.parentElement;
    while (!nodes.has(el)) {
      node = createNode(TYPE_CONTAINER, el, [node]);
      el = el.parentElement;
    }
    nodes.get(el).children.push(node);
  }

  if (root.children.length === 0) return null;

  const countImages = (node) => {
    if (node.type === TYPE_IMAGE) {
      return (node.imagesCount = 1);
    }
    let imagesCount = 0;
    for (let i = 0; i < node.children.length; i++) {
      imagesCount += countImages(node.children[i]);
    }
    return (node.imagesCount = imagesCount);
  };

  const imagesCount = countImages(root);
  if (imagesCount === 1) return null;

  // Find depeest node that contains more than `containerTreeshold` images
  let containerTreeshold = imagesCount / 2;
  search: while (true) {
    for (let i = 0; i < root.children.length; i++) {
      if (root.children[i].imagesCount > containerTreeshold) {
        root = root.children[i];
        continue search;
      }
    }
    break search;
  }

  const buildPage = (width, height) => ({
    width,
    height,
    images: [],
    text: [],
  });
  const buildImage = (left, bottom, width, height, src) => ({
    left,
    bottom,
    width,
    height,
    src,
  });
  const buildText = (
    left,
    bottom,
    width,
    height,
    font,
    size,
    color,
    opacity,
    transform,
    text
  ) => ({
    left,
    bottom,
    width,
    height,
    font,
    size,
    color,
    opacity,
    transform,
    text,
  });

  const pages = [];
  for (const element of root.element.children) {
    const rect = element.getBoundingClientRect();
    const page = buildPage(rect.width, rect.height);
    pages.push(page);

    findNodes(page, element, rect.left, rect.bottom, 1, new DOMMatrix());
  }

  function findNodes(page, element, pageX, pageY, opacity, matrix) {
    if (element.nodeName.toUpperCase() === "IMG") {
      const rect = element.getBoundingClientRect();
      page.images.push(
        buildImage(
          rect.left - pageX,
          pageY - rect.bottom,
          rect.width,
          rect.height,
          element.getAttribute("src")
        )
      );
      return;
    }

    const style = getComputedStyle(element);
    if (style.transform !== "none") {
      matrix = matrix.multiply(new DOMMatrix(style.transform));
    }

    if (
      ([].some.call(
        element.childNodes,
        (child) =>
          child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== ""
      ) ||
        [].every.call(
          element.childNodes,
          (child) => child.nodeType === Node.TEXT_NODE
        )) &&
      element.textContent !== ""
    ) {
      const rect = element.getBoundingClientRect();

      const span = document.createElement("span");
      span.setAttribute("style", "font-size:0");
      span.innerText = "A";
      element.append(span);
      const baseline = span.getBoundingClientRect().bottom - rect.bottom;
      span.remove();

      const color =
        parseList(style.color, "rgb(", ")") ||
        parseList(style.color, "rgba(", ")");

      let op = opacity * style.opacity;
      if (color?.length === 4) {
        op *= color.pop();
      }

      page.text.push(
        buildText(
          rect.left - pageX,
          pageY - rect.bottom - baseline,
          rect.width,
          rect.height,
          style.fontFamily,
          parseFloat(style.fontSize),
          color,
          op,
          domMatrixToList(matrix),
          element.textContent
        )
      );
      return;
    }

    for (const child of element.children) {
      findNodes(page, child, pageX, pageY, opacity * style.opacity, matrix);
    }
  }

  function parseList(str, prefix, suffix) {
    return str.startsWith(prefix)
      ? str
          .slice(prefix.length, -suffix.length)
          .split(",")
          .map((s) => parseFloat(s))
      : null;
  }

  function domMatrixToList(matrix) {
    return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
  }

  return pages;
}

async function processPage(pdf, pdfPage, page, getFont) {
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
    const font = await getFont(text.font);

    let opacity = text.opacity;
    let color =
      text.color == null ? undefined : rgb(...text.color.map((c) => c / 255));

    pdfPage.drawText(text.text, {
      font,
      x: text.left,
      y: text.bottom,
      size: text.size,
      opacity: opacity,
      color,
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
}

function extractFontURL($container, fontFamily) {
  for (const styleSheet of $container.ownerDocument.styleSheets) {
    for (const rule of styleSheet.rules) {
      if (
        rule.constructor.name ==="CSSFontFaceRule" &&
        rule.style.getPropertyValue("font-family") === fontFamily
      ) {
        let src =  rule.style.getPropertyValue("src");
        if (src.startsWith("url(")) {
          src = src.slice("url(".length, -")".length);
          if (src.startsWith('"') || src.startsWith("'")) src = src.slice(1, -1);

          return src;
        } else {
          throw new Error(`Cannot extract font ${fontFamily} with src ${src}`);
        }
      }
    }
  }

  throw new Error(`Cannot find font ${fontFamily}`);
}
