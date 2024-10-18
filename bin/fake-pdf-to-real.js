import { pathToFileURL } from "node:url"
import { writeFile } from "node:fs/promises";
import { Converter } from "../src/index.js"

const url = pathToFileURL(process.argv[2]);

const converter = new Converter();
await converter.open(url);

if (converter.looksLikePDF()) {
  console.warn("It looks like a fake PDF!");
} else {
  console.warn("Not a supported fake PDF :(");
}

const pdf = await converter.convertToPdf();
if (process.argv[3]) {
  await writeFile(process.argv[3], pdf);
} else {
  process.stdout.write(pdf);
}

await converter.close();

