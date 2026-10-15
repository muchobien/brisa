import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";
await mkdir("public/icons", { recursive: true });
const source = await readFile("public/icon.svg");
for (const size of [180, 192, 512])
  await sharp(source).resize(size).png().toFile(`public/icons/icon-${size}.png`);
await sharp(source)
  .resize(360)
  .extend({ top: 76, bottom: 76, left: 76, right: 76, background: "#6e5ee8" })
  .png()
  .toFile("public/icons/maskable-512.png");
await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><g fill="none" stroke="white" stroke-width="7" stroke-linecap="round"><path d="M18 30h45c20 0 20-22 5-22-7 0-10 4-10 8M18 48h60M18 66h32c18 0 18 22 3 22-7 0-10-4-10-8"/></g></svg>',
  ),
)
  .png()
  .toFile("public/icons/badge.png");
