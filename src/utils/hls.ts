export type HlsDetails = {
  programDateTime?: string | number | Date;
  fragments?: Array<{ start?: number; programDateTime?: string | number | Date; pdt?: string | number | Date }>;
  dateRanges?: any[] | Record<string, any>;
  dateranges?: any[] | Record<string, any>;
};

export function extractDateRangesFromText(text: string): any[] {
  const lines = (text || "").split(/\r?\n/);
  const ranges: any[] = [];
  for (const line of lines) {
    if (line.startsWith("#EXT-X-DATERANGE:")) {
      const attrs: Record<string, string> = {};
      line.replace(/^#EXT-X-DATERANGE:/, "")
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .forEach((kv) => {
          const [k, v] = kv.split("=");
          if (k) attrs[k.trim()] = (v || "").replace(/^"|"$/g, "");
        });
      ranges.push(attrs);
    }
  }
  return ranges;
}

export function deriveAnchorDate(details: HlsDetails): Date | null {
  if (!details) return null;
  let anchorDate = details.programDateTime ? new Date(details.programDateTime) : null;
  const frags = details.fragments || [];
  const first = frags.find((f) => f && (f.programDateTime || f.pdt));
  if (!anchorDate && first) anchorDate = new Date(first.programDateTime || first.pdt as any);
  return anchorDate || null;
}

export function extractAssetListFromRange(range: any, rawManifest?: string): string | null {
  let assetList = range?.["X-ASSET-LIST"] || range?.["X-ASSETLIST"] || range?.assetList || range?.["x-asset-list"] || range?.xAssetList;

  // Fallbacks used in your code: scan attrs string and then scan the raw manifest line for this daterange
  if (!assetList && range?.attr?.toString) {
    const attrStr = range.attr.toString();
    const m = attrStr.match(/X-ASSET-LIST=([^,]+)/i);
    if (m) assetList = m[1].replace(/^"|"$/g, "");
  }
  if (!assetList && typeof rawManifest === "string") {
    const rid = range?.ID || range?.id;
    if (rid) {
      const line = rawManifest.match(new RegExp(`#EXT-X-DATERANGE:[^\\n]*ID="${rid}"[^\\n]*`, "i"))?.[0];
      const m = line && line.match(/X-ASSET-LIST="([^"]+)"/i);
      if (m) assetList = m[1];
    }
  }
  return assetList || null;
}
