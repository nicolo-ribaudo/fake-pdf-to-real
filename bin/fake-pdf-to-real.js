import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import { Converter } from "../src/index.js";

const url = pathToFileURL(process.argv[2]);

const converter = new Converter();
console.warn(`Loading ${url}...`);
await converter.open(url);
console.warn(`Loaded`);

const pdf = await converter.convertToPdf();
if (!pdf) {
  console.error("Could not extract PDF");
} else {
  if (process.argv[3]) {
    await writeFile(process.argv[3], pdf);
  } else {
    process.stdout.write(pdf);
  }
}

await converter.close();
