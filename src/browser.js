// ASSUMPTION: Most pages contain an image
export function extractPages() {
  const images = document.querySelectorAll("img[src^='data:']");

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

  let root = createNode(TYPE_CONTAINER, document.body, []);

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

export function extractFont(fontFamily) {
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
}
