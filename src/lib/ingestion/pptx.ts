/**
 * Deterministic PPTX parsing: structured ZIP/XML, no OCR.
 *
 * PPTX is a ZIP of XML parts. Slide order lives in ppt/presentation.xml's
 * <p:sldIdLst>, resolved through ppt/_rels/presentation.xml.rels — the
 * numbers in slide filenames (slide1.xml, slide10.xml, ...) are not
 * reliable order on their own. Speaker notes are a separate part per
 * slide, linked via that slide's own .rels file.
 *
 * Recovers per slide: index, title (if a title placeholder exists),
 * body text, and speaker notes. This is intentionally not a PPTX
 * renderer — visual fidelity is out of scope for v1 (see docs/DECISIONS.md).
 */
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface ParsedSlide {
  index: number; // 1-based, matches presentation order
  title: string | null;
  text: string;
  speakerNotes: string | null;
}

export interface ParsedPptx {
  slides: ParsedSlide[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function readXml(zip: JSZip, path: string): Promise<unknown | null> {
  const file = zip.file(path);
  if (!file) return null;
  const content = await file.async("string");
  return xmlParser.parse(content);
}

/** Resolves a relative rels Target against the part that owns the .rels file. */
function resolveTarget(basePartDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = basePartDir.split("/").filter(Boolean);
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

async function readRelationships(
  zip: JSZip,
  relsPath: string,
  basePartDir: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const parsed = (await readXml(zip, relsPath)) as
    | { Relationships?: { Relationship?: unknown } }
    | null;
  if (!parsed?.Relationships?.Relationship) return map;

  for (const rel of toArray(parsed.Relationships.Relationship) as Array<
    Record<string, string>
  >) {
    const id = rel["@_Id"];
    const target = rel["@_Target"];
    if (id && target) {
      map.set(id, resolveTarget(basePartDir, target));
    }
  }
  return map;
}

/** Collects all <a:t> text within a node, in document order, as one string. */
function collectText(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(collectText).filter(Boolean).join(" ");
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const parts: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith("@_")) continue;
      parts.push(collectText(value));
    }
    return parts.filter(Boolean).join(" ");
  }
  return "";
}

interface ShapeInfo {
  isTitle: boolean;
  isSkippableNotesPlaceholder: boolean;
  text: string;
}

function extractShapeInfo(sp: unknown): ShapeInfo {
  const shape = sp as Record<string, unknown>;
  const nvSpPr = shape["p:nvSpPr"] as Record<string, unknown> | undefined;
  const nvPr = nvSpPr?.["p:nvPr"] as Record<string, unknown> | undefined;
  const ph = nvPr?.["p:ph"] as Record<string, string> | undefined;
  const phType = ph?.["@_type"];

  const isTitle = phType === "title" || phType === "ctrTitle";
  const isSkippableNotesPlaceholder =
    phType === "sldImg" || phType === "sldNum" || phType === "ftr" || phType === "dt";

  const txBody = shape["p:txBody"];
  const paragraphs = toArray(
    (txBody as Record<string, unknown> | undefined)?.["a:p"],
  );
  const text = paragraphs
    .map((p) => collectText(p))
    .filter(Boolean)
    .join("\n")
    .trim();

  return { isTitle, isSkippableNotesPlaceholder, text };
}

function shapesFromTree(spTree: unknown): unknown[] {
  const tree = spTree as Record<string, unknown> | undefined;
  return toArray(tree?.["p:sp"]);
}

async function parseSlideText(
  zip: JSZip,
  slidePath: string,
): Promise<{ title: string | null; text: string }> {
  const parsed = (await readXml(zip, slidePath)) as
    | { "p:sld"?: { "p:cSld"?: { "p:spTree"?: unknown } } }
    | null;
  const spTree = parsed?.["p:sld"]?.["p:cSld"]?.["p:spTree"];
  const shapes = shapesFromTree(spTree).map(extractShapeInfo);

  const titleShape = shapes.find((s) => s.isTitle && s.text);
  const bodyShapes = shapes.filter((s) => s !== titleShape && s.text);

  return {
    title: titleShape?.text ?? null,
    text: bodyShapes.map((s) => s.text).join("\n\n"),
  };
}

async function parseSpeakerNotes(
  zip: JSZip,
  notesPath: string,
): Promise<string | null> {
  const parsed = (await readXml(zip, notesPath)) as
    | { "p:notes"?: { "p:cSld"?: { "p:spTree"?: unknown } } }
    | null;
  const spTree = parsed?.["p:notes"]?.["p:cSld"]?.["p:spTree"];
  const shapes = shapesFromTree(spTree)
    .map(extractShapeInfo)
    .filter((s) => !s.isSkippableNotesPlaceholder && s.text);

  const text = shapes.map((s) => s.text).join("\n\n").trim();
  return text || null;
}

export async function parsePptx(data: ArrayBuffer | Buffer): Promise<ParsedPptx> {
  const zip = await JSZip.loadAsync(data);

  const presentation = (await readXml(zip, "ppt/presentation.xml")) as {
    "p:presentation"?: { "p:sldIdLst"?: { "p:sldId"?: unknown } };
  } | null;

  const sldIds = toArray(
    presentation?.["p:presentation"]?.["p:sldIdLst"]?.["p:sldId"],
  ) as Array<Record<string, string>>;

  const presentationRels = await readRelationships(
    zip,
    "ppt/_rels/presentation.xml.rels",
    "ppt",
  );

  const orderedSlidePaths = sldIds
    .map((s) => presentationRels.get(s["@_r:id"]))
    .filter((p): p is string => Boolean(p));

  const slides: ParsedSlide[] = [];

  for (let i = 0; i < orderedSlidePaths.length; i++) {
    const slidePath = orderedSlidePaths[i];
    const slideDir = slidePath.split("/").slice(0, -1).join("/");
    const slideFileName = slidePath.split("/").pop()!;
    const relsPath = `${slideDir}/_rels/${slideFileName}.rels`;

    const { title, text } = await parseSlideText(zip, slidePath);

    const slideRels = await readRelationships(zip, relsPath, slideDir);
    let speakerNotes: string | null = null;
    for (const target of slideRels.values()) {
      if (target.includes("notesSlides/")) {
        speakerNotes = await parseSpeakerNotes(zip, target);
        break;
      }
    }

    slides.push({ index: i + 1, title, text, speakerNotes });
  }

  return { slides };
}
