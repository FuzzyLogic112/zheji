export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Redaction extends Box {
  id: string;
  color: string;
}

export interface Watermark {
  enabled: boolean;
  text: string;
  opacity: number;
  color: string;
}

export interface LoadedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  format: "png" | "jpeg";
  size: number;
}

export interface ImageHeader {
  width: number;
  height: number;
  format: "png" | "jpeg";
}

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;
export const MAX_IMAGE_SIDE = 12_000;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_REQUIRED_CHUNKS = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function invalid(message: string): never {
  throw new Error(message);
}

function checkDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    invalid("图片尺寸无效。");
  }
  if (
    width > MAX_IMAGE_SIDE ||
    height > MAX_IMAGE_SIDE ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    invalid("图片过大：最多 2000 万像素，且任一边不能超过 12000 像素。");
  }
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 256 + bytes[offset + 1]!;
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset++) {
    crc = crcTable[(crc ^ bytes[offset]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface PngChunk {
  type: string;
  start: number;
  end: number;
}

/** Structural preflight only; the browser still has to decode the compressed pixels. */
function inspectPng(
  bytes: Uint8Array,
  onChunk?: (chunk: PngChunk) => void,
): ImageHeader {
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    invalid("PNG 文件签名无效。");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = 0;
  let paletteEntries = 0;
  let seenTransparency = false;
  let seenData = false;
  let endedData = false;
  let dataBytes = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) invalid("PNG 文件不完整，区块已截断。");
    const length = u32(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const end = dataEnd + 4;
    if (end > bytes.length) invalid("PNG 文件不完整，区块长度超出文件。");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, dataStart));
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) invalid("PNG 区块类型无效。");
    if (type === "acTL" || type === "fcTL" || type === "fdAT") {
      invalid("暂不支持动画 PNG（APNG），请使用静态 PNG 或 JPEG。");
    }
    if (offset === 8 && (type !== "IHDR" || length !== 13))
      invalid("PNG 缺少有效的 IHDR 图片头。");
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) invalid("PNG 图片头重复或无效。");
      width = u32(bytes, dataStart);
      height = u32(bytes, dataStart + 4);
      checkDimensions(width, height);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      const validDepths: Record<number, readonly number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !validDepths[colorType]?.includes(bitDepth) ||
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        bytes[dataStart + 12]! > 1
      )
        invalid("PNG 图片头中的编码参数无效。");
    } else if (type === "PLTE") {
      if (
        paletteEntries ||
        seenData ||
        seenTransparency ||
        length === 0 ||
        length > 768 ||
        length % 3 !== 0 ||
        colorType === 0 ||
        colorType === 4 ||
        (colorType === 3 && length / 3 > 2 ** bitDepth)
      )
        invalid("PNG 调色板结构无效。");
      paletteEntries = length / 3;
    } else if (type === "tRNS") {
      if (
        seenTransparency ||
        seenData ||
        !(
          (colorType === 0 && length === 2) ||
          (colorType === 2 && length === 6) ||
          (colorType === 3 &&
            paletteEntries > 0 &&
            length > 0 &&
            length <= paletteEntries)
        )
      )
        invalid("PNG 透明度区块无效。");
      seenTransparency = true;
    } else if (type === "IDAT") {
      if (endedData || (colorType === 3 && !paletteEntries))
        invalid("PNG 像素区块顺序无效。");
      seenData = true;
      dataBytes += length;
    } else if (type === "IEND") {
      if (
        length !== 0 ||
        !seenData ||
        dataBytes === 0 ||
        end !== bytes.length
      ) {
        invalid("PNG 文件结尾无效或像素数据缺失。");
      }
    } else if (type.charCodeAt(0) < 97) {
      invalid("PNG 包含不受支持的关键区块。");
    }
    if (seenData && type !== "IDAT") endedData = true;
    if (crc32(bytes, offset + 4, dataEnd) !== u32(bytes, dataEnd)) {
      invalid("PNG 区块校验失败，文件可能已损坏。");
    }
    onChunk?.({ type, start: offset, end });
    if (type === "IEND") return { format: "png", width, height };
    offset = end;
  }
  return invalid("PNG 文件缺少完整的结束区块。");
}

function inspectJpeg(bytes: Uint8Array): ImageHeader {
  let offset = 2;
  let width = 0;
  let height = 0;
  let componentIds: number[] = [];
  let seenScan = false;
  let seenEntropy = false;
  let inScan = false;
  while (offset < bytes.length) {
    if (inScan && bytes[offset] !== 0xff) {
      seenEntropy = true;
      offset++;
      continue;
    }
    if (bytes[offset] !== 0xff) invalid("JPEG 区段标记无效。");
    while (bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) invalid("JPEG 文件不完整，标记已截断。");
    const marker = bytes[offset++]!;
    if (inScan && marker === 0) {
      seenEntropy = true;
      continue;
    }
    if (inScan && marker >= 0xd0 && marker <= 0xd7) continue;
    inScan = false;
    if (marker === 0xd9) {
      if (!width || !seenScan || !seenEntropy || offset !== bytes.length) {
        invalid("JPEG 文件结尾无效或像素数据缺失。");
      }
      return { format: "jpeg", width, height };
    }
    if (
      marker < 0xc0 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      invalid("JPEG 包含无效或不受支持的标记。");
    }
    if (offset + 2 > bytes.length) invalid("JPEG 区段长度已截断。");
    const length = u16(bytes, offset);
    const start = offset + 2;
    const end = offset + length;
    if (length < 2 || end > bytes.length)
      invalid("JPEG 文件不完整，区段已截断。");
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (marker !== 0xc0 && marker !== 0xc1 && marker !== 0xc2) {
        invalid("此 JPEG 编码暂不支持，请转换为普通 JPEG 或 PNG。");
      }
      if (width || length < 8) invalid("JPEG 图片头重复或无效。");
      height = u16(bytes, start + 1);
      width = u16(bytes, start + 3);
      checkDimensions(width, height);
      const components = bytes[start + 5]!;
      if (
        bytes[start] !== 8 ||
        ![1, 3, 4].includes(components) ||
        length !== 8 + components * 3
      ) {
        invalid("JPEG 图片头中的编码参数无效。");
      }
      componentIds = [];
      for (let index = 0; index < components; index++) {
        const pos = start + 6 + index * 3;
        const id = bytes[pos]!;
        const sampling = bytes[pos + 1]!;
        if (
          componentIds.includes(id) ||
          sampling >> 4 < 1 ||
          sampling >> 4 > 4 ||
          (sampling & 15) < 1 ||
          (sampling & 15) > 4 ||
          bytes[pos + 2]! > 3
        )
          invalid("JPEG 色彩分量无效。");
        componentIds.push(id);
      }
    } else if (marker === 0xda) {
      const components = bytes[start]!;
      if (
        !width ||
        length < 6 ||
        components < 1 ||
        components > componentIds.length ||
        length !== 6 + components * 2
      ) {
        invalid("JPEG 像素扫描头无效。");
      }
      const scanIds = new Set<number>();
      for (let index = 0; index < components; index++) {
        const id = bytes[start + 1 + index * 2]!;
        const tables = bytes[start + 2 + index * 2]!;
        if (
          !componentIds.includes(id) ||
          scanIds.has(id) ||
          tables >> 4 > 3 ||
          (tables & 15) > 3
        ) {
          invalid("JPEG 像素扫描分量无效。");
        }
        scanIds.add(id);
      }
      seenScan = true;
      inScan = true;
    }
    offset = end;
  }
  return invalid("JPEG 文件已截断或缺少结束标记。");
}

/** Inspect actual bytes, never the file extension or untrusted MIME type. */
export function inspectImageBytes(bytes: Uint8Array): ImageHeader {
  if (bytes.length === 0) invalid("图片文件为空。");
  if (bytes.length > MAX_FILE_BYTES) invalid("图片文件不能超过 20 MiB。");
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value))
    return inspectPng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes);
  return invalid("仅支持静态 PNG 或 JPEG 图片，不支持 SVG、GIF 或其他格式。");
}

export async function loadImage(file: File): Promise<LoadedImage> {
  if (file.size === 0) invalid("图片文件为空。");
  if (file.size > MAX_FILE_BYTES) invalid("图片文件不能超过 20 MiB。");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return invalid("无法读取图片文件，请重新选择文件。");
  }
  const header = inspectImageBytes(bytes);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return invalid(
      "图片无法解码，可能已损坏或格式不受支持。请换一张 PNG 或 JPEG。",
    );
  }
  try {
    checkDimensions(bitmap.width, bitmap.height);
    // EXIF orientation can swap the two dimensions without changing the pixel budget.
    if (
      !(bitmap.width === header.width && bitmap.height === header.height) &&
      !(bitmap.width === header.height && bitmap.height === header.width)
    )
      invalid("解码后的图片尺寸与文件头不一致，无法安全处理。");
    return {
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      format: header.format,
      size: file.size,
    };
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

export function normalizeBox(
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  height: number,
): Box {
  checkDimensions(width, height);
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite))
    invalid("选区坐标必须是有限数字。");
  const x = Math.max(0, Math.min(width, Math.floor(Math.min(start.x, end.x))));
  const y = Math.max(0, Math.min(height, Math.floor(Math.min(start.y, end.y))));
  const right = Math.max(
    0,
    Math.min(width, Math.ceil(Math.max(start.x, end.x))),
  );
  const bottom = Math.max(
    0,
    Math.min(height, Math.ceil(Math.max(start.y, end.y))),
  );
  return { x, y, width: right - x, height: bottom - y };
}

function boundedBox(box: Box, width: number, height: number): Box {
  if (
    ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    box.width < 0 ||
    box.height < 0
  ) {
    invalid("选区位置和尺寸无效。");
  }
  return normalizeBox(
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    width,
    height,
  );
}

function checkColor(color: string): void {
  if (
    typeof color !== "string" ||
    !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)
  ) {
    invalid("颜色必须是不透明的十六进制颜色，例如 #000000。");
  }
}

function drawWatermark(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  crop: Box,
  watermark: Watermark,
): void {
  if (!watermark.enabled || !watermark.text.trim() || watermark.opacity === 0)
    return;
  const fontSize = Math.max(
    18,
    Math.min(56, Math.round(Math.min(width, height) * 0.045)),
  );
  const angle = -Math.PI / 6;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const corners = [
    [crop.x, crop.y],
    [crop.x + crop.width, crop.y],
    [crop.x, crop.y + crop.height],
    [crop.x + crop.width, crop.y + crop.height],
  ].map(([x, y]) => ({
    x: (x! - width / 2) * cosine + (y! - height / 2) * sine,
    y: -(x! - width / 2) * sine + (y! - height / 2) * cosine,
  }));
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(angle);
  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  context.fillStyle = watermark.color;
  context.globalAlpha = watermark.opacity;
  context.textBaseline = "middle";
  context.textAlign = "center";
  const textWidth = context.measureText(watermark.text).width;
  const stepX = Math.max(fontSize * 8, textWidth + fontSize * 4);
  const stepY = fontSize * 5;
  const minX =
    Math.min(...corners.map((point) => point.x)) - textWidth / 2 - fontSize;
  const maxX =
    Math.max(...corners.map((point) => point.x)) + textWidth / 2 + fontSize;
  const minY = Math.min(...corners.map((point) => point.y)) - fontSize;
  const maxY = Math.max(...corners.map((point) => point.y)) + fontSize;
  // Absolute grid indices keep the same watermark placement when exporting a crop.
  for (
    let row = Math.floor(minY / stepY);
    row <= Math.ceil(maxY / stepY);
    row++
  ) {
    for (
      let col = Math.floor(minX / stepX);
      col <= Math.ceil(maxX / stepX);
      col++
    ) {
      context.fillText(watermark.text, col * stepX, row * stepY);
    }
  }
  context.restore();
}

export function renderCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  redactions: Redaction[],
  crop: Box | null,
  watermark: Watermark,
): HTMLCanvasElement {
  checkDimensions(width, height);
  checkColor(watermark.color);
  if (
    typeof watermark.enabled !== "boolean" ||
    typeof watermark.text !== "string" ||
    Array.from(watermark.text).length > 80 ||
    !Number.isFinite(watermark.opacity) ||
    watermark.opacity < 0 ||
    watermark.opacity > 1
  )
    invalid("水印设置无效：文字最多 80 个字符，透明度须在 0 到 1 之间。");
  if (crop && (crop.width <= 0 || crop.height <= 0))
    invalid("裁剪区域必须有实际面积。");
  const output = crop
    ? boundedBox(crop, width, height)
    : { x: 0, y: 0, width, height };
  if (output.width === 0 || output.height === 0)
    invalid("裁剪区域必须与图片相交且有实际面积。");
  const boxes = redactions.map((redaction) => {
    checkColor(redaction.color);
    return { ...boundedBox(redaction, width, height), color: redaction.color };
  });
  const canvas = document.createElement("canvas");
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) invalid("浏览器无法创建图片画布，请重试或更换浏览器。");
  context.globalAlpha = 1;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(-output.x, -output.y);
  context.drawImage(source, 0, 0, width, height);
  drawWatermark(context, width, height, output, watermark);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  for (const box of boxes) {
    // Integer, outward-rounded edges plus opaque fill prevent partial edge pixels.
    context.fillStyle = box.color;
    context.fillRect(box.x, box.y, box.width, box.height);
  }
  return canvas;
}

/** Keep only pixel-decoding chunks; EXIF, text, profiles and private chunks are dropped. */
export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const kept: PngChunk[] = [];
  let length = PNG_SIGNATURE.length;
  inspectPng(bytes, (chunk) => {
    if (PNG_REQUIRED_CHUNKS.has(chunk.type)) {
      kept.push(chunk);
      length += chunk.end - chunk.start;
    }
  });
  const result = new Uint8Array(length);
  result.set(PNG_SIGNATURE);
  let offset = PNG_SIGNATURE.length;
  for (const chunk of kept) {
    result.set(bytes.subarray(chunk.start, chunk.end), offset);
    offset += chunk.end - chunk.start;
  }
  return result;
}

export async function exportPng(
  source: CanvasImageSource,
  width: number,
  height: number,
  redactions: Redaction[],
  crop: Box | null,
  watermark: Watermark,
): Promise<Blob> {
  const canvas = renderCanvas(
    source,
    width,
    height,
    redactions,
    crop,
    watermark,
  );
  let encoded: Blob;
  try {
    encoded = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG 编码失败。"))),
        "image/png",
      );
    });
  } catch {
    return invalid("图片导出失败，浏览器可能没有足够内存，请缩小图片后重试。");
  } finally {
    // Encoding owns the pixels only until its callback completes. Release the
    // temporary surface before metadata cleanup, including the error path.
    canvas.width = 0;
    canvas.height = 0;
  }
  const cleaned = stripPngMetadata(new Uint8Array(await encoded.arrayBuffer()));
  return new Blob([new Uint8Array(cleaned)], { type: "image/png" });
}
