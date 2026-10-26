import type { ColumnDecision, ColumnStats, Dataset } from "./types";

export const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const CODE_LIKE = /^[A-Za-z0-9_\-./:#\\]+$/;
const KEY_HEADER = /(^|[_\s-])(id|key|code|sku|uid|guid|path|url|icon|file|img|image)($|[_\s-])|编号|编码|代码|路径|链接|图标/i;

export function columnStats(ds: Dataset, index: number): ColumnStats {
  const values = ds.rows.map((r) => r[index]).filter((v) => v.trim() !== "");
  const nonEmpty = values.length;
  const chinese = values.filter((v) => HAN.test(v)).length;
  const codeLike = values.filter((v) => CODE_LIKE.test(v.trim())).length;
  const unique = Array.from(new Set(values));
  return {
    nonEmpty,
    chineseShare: nonEmpty ? chinese / nonEmpty : 0,
    codeLikeShare: nonEmpty ? codeLike / nonEmpty : 0,
    uniqueValues: unique.length,
    samples: unique.slice(0, 8),
  };
}

/**
 * Rule-based first pass. Clear cases are decided here for free;
 * anything in the grey zone is returned as `undecided` for the AI to judge.
 */
export function ruleDecisions(ds: Dataset): { decided: ColumnDecision[]; undecided: { name: string; index: number; stats: ColumnStats }[] } {
  const decided: ColumnDecision[] = [];
  const undecided: { name: string; index: number; stats: ColumnStats }[] = [];

  ds.headers.forEach((name, index) => {
    const stats = columnStats(ds, index);
    const pct = Math.round(stats.chineseShare * 100);
    const base = { name, index, method: "rule" as const, stats };

    if (stats.nonEmpty === 0) {
      decided.push({ ...base, translate: false, reason: "Column is empty" });
    } else if (stats.chineseShare === 0) {
      const what = stats.codeLikeShare > 0.8 ? "IDs, numbers or file paths" : "text with no Chinese";
      decided.push({ ...base, translate: false, reason: `No Chinese found (${what})` });
    } else if (KEY_HEADER.test(name)) {
      // A key/ID column that happens to contain Chinese is risky either way: let the AI look.
      undecided.push({ name, index, stats });
    } else if (stats.chineseShare >= 0.6) {
      decided.push({ ...base, translate: true, reason: `${pct}% of cells contain Chinese text` });
    } else {
      undecided.push({ name, index, stats });
    }
  });

  return { decided, undecided };
}
