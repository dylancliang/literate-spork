// Shared types for the browser-side pipeline and the server API routes.

export type Lang = { code: string; name: string };

/** Who performed a step: plain code, an AI model call, or the user. */
export type Actor = "code" | "ai" | "user";

export type TraceEvent = {
  id: string;
  step: string; // short machine name, e.g. "profile_csv"
  actor: Actor;
  title: string; // one-line, human readable
  detail?: string; // optional longer explanation
  data?: unknown; // optional structured payload shown as JSON
  ms?: number;
  status: "ok" | "warn" | "error";
  at: number;
};

export type Dataset = {
  fileName: string;
  encoding: string;
  delimiter: string;
  headers: string[];
  rows: string[][];
};

export type ColumnDecision = {
  name: string;
  index: number;
  translate: boolean;
  method: "rule" | "ai" | "user";
  reason: string;
  stats: ColumnStats;
};

export type ColumnStats = {
  nonEmpty: number;
  chineseShare: number; // share of non-empty cells containing Chinese characters
  codeLikeShare: number; // share of non-empty cells that look like IDs/numbers/paths
  uniqueValues: number;
  samples: string[];
};

/** One distinct piece of text to translate (deduplicated per column). */
export type Unit = { id: string; column: string; text: string };

export type TranslateItem = { id: string; column: string; text: string; problem?: string };

export type FollowupAction = {
  action: "add_languages" | "retranslate" | "answer";
  languages: Lang[];
  instruction: string;
  rows: number[]; // 1-based data row numbers; empty = all rows
  reply: string;
};

/** The thin server API the pipeline depends on. The browser implements it with fetch; tests use a fake. */
export interface AgentApi {
  parseLanguages(text: string): Promise<Lang[]>;
  classifyColumns(
    columns: { name: string; stats: ColumnStats }[]
  ): Promise<{ name: string; translate: boolean; reason: string }[]>;
  translate(req: { lang: Lang; items: TranslateItem[]; instruction?: string }): Promise<{ id: string; text: string }[]>;
  routeFollowup(req: {
    message: string;
    languages: Lang[];
    columns: { name: string; translate: boolean; reason: string }[];
    rowCount: number;
  }): Promise<FollowupAction>;
}
