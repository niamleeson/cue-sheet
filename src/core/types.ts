export const COLS = ['content', 'role', 'mic', 'screen', 'light', 'inout', 'stage', 'details'] as const;
export type Col = (typeof COLS)[number];
export const COL_LABELS: Record<Col, string> = {
  content: '내용', role: '담당', mic: '음향', screen: '화면', light: '조명', inout: '입-출', stage: '무대', details: '세부사항',
};

/** A rule line: literal text (may contain {token|default}), a list placeholder, or a conditional line. */
export type RuleLine =
  | string
  | { list: string; fmt: string; default: string[] }
  | { if: string; text: string };

export interface Source { kind: 'guideline' | 'supplement' | 'user'; ref: string; note?: string }

export interface RowRule {
  key: string;
  name: string;
  aliases: string[];
  aliasPattern?: string;
  aliasParam?: string;
  dur: number;
  cells: Partial<Record<Col, RuleLine[]>>;
  video?: string;
  /** cell background, e.g. D9D9D9 (the guideline shades the 설교 row) */
  shade?: string;
}

export type Op =
  | { op: 'insertAfter'; anchor: string; row: RowRule }
  | { op: 'replace'; target: string; row: RowRule }
  | { op: 'setDur'; target: string; dur: number }
  | { op: 'setCell'; target: string; col: Col; lines: RuleLine[] }
  | { op: 'setName'; target: string; title: string; name: string; aliases?: string[] }
  | { op: 'move'; target: string; after: string }
  | { op: 'removeLine'; target: string; col: Col; line: string }
  | { op: 'addLines'; target: string; col: Col; lines: RuleLine[]; at?: number }
  | { op: 'addMic'; mic: string; if?: string; note?: string };

export interface ParamDef { key: string; label: string; list?: boolean }

export interface SpecialRule {
  id: string;
  label: string;
  auto: 'week1' | 'week2' | null;
  source: Source;
  notes: string[];
  params: ParamDef[];
  prep: string[];
  ops: Op[];
}

export interface ServiceRules {
  id: string;
  label: string;
  title: string;
  start: string;
  template: string;
  fileName: string;
  guidelineTable: number;
  source: Source;
  defaults: { vocals: number; leaders: number };
  /** [input key, label, optional?] */
  cast: [string, string, boolean?][];
  roleMics: Record<string, string>;
  /** timeline columns of this service's table (event tables drop 입-출/무대) */
  cols: Col[];
  rehearsal: { dur: number; cells: Record<string, RuleLine[]> };
  rows: RowRule[];
  specials: SpecialRule[];
  timer?: { from: string; to: string };
}

export type Kind = 'sunday' | 'wed' | 'newyear' | 'baptism' | 'christmas' | 'yearend' | 'bridge';
export interface Occasion { id: Kind; label: string; services: string[]; weekday?: number | null; note?: string }

export interface RulesFile {
  guideline: string;
  staffOrder: string[];
  services: Record<string, ServiceRules>;
  occasions: Occasion[];
}

// ---------------- document (v2): one per Sunday / event ----------------

export interface Fields {
  /** 사회, 설교, 인도, 나래이션, PD, FD, 음향 ... */
  people: Record<string, string>;
  /** scalar tokens: 봉헌위원, 분병분잔, 특순, 영상이름 ... */
  values: Record<string, string>;
  /** list tokens: 찬양, 본문, 설교제목, 봉헌찬양 ... */
  lists: Record<string, string[]>;
}

/** Places `key` right after `after` (null = first); `before` is the fallback anchor. `title` marks a row the user added. */
export interface Move { key: string; after: string | null; before?: string | null; title?: string }

/** Per-service data. A key present here (even '') overrides the document's shared value. */
export interface ServiceDoc extends Fields {
  start?: string;
  vocals?: number;
  leaders?: number;
  /** explicit on/off per special; missing = automatic (guideline) */
  specials: Record<string, boolean>;
  moves: Move[];
  /** rows taken out of this service */
  off: string[];
  durs: Record<string, number>;
}

/** Cells the preview can edit: a timeline column, the time cell, the split rehearsal light cell or a header block. */
export type EditCol = Col | 'time' | 'lightA' | 'lightB' | 'staff' | 'cast' | 'mics' | 'videos';

/** Line-level change applied to a finished cell; anchors are matched by text so edits survive upstream changes. */
export type LineOp =
  | { op: 'remove'; line: string }
  | { op: 'replace'; line: string; with: string }
  | { op: 'insert'; after: string | null; line: string }
  | { op: 'append'; line: string }
  | { op: 'set'; lines: string[] }
  | { op: 'sub'; from: string; to: string };

export interface CellEdit {
  id: string;
  /** row key, 'rehearsal' or 'header' */
  row: string;
  col: EditCol;
  services: string[];
  ops: LineOp[];
  /** linked changes in other cells of the same row (담당 변경 → 음향 Mic) */
  also?: { col: EditCol; ops: LineOp[] }[];
  at: string;
  note?: string;
}

export interface CueDoc {
  v: 2;
  id: string;
  kind: Kind;
  date: string; // YYYY-MM-DD
  name?: string;
  updatedAt: string;
  /** values every service takes unless it has its own (typed once, in any service's form) */
  shared: Fields;
  /** the service whose form a shared value was typed in; the other services show it as a placeholder */
  origin: Record<keyof Fields, Record<string, string>>;
  services: Record<string, ServiceDoc>;
  edits: CellEdit[];
}

// ---------------- v1 input (text import and old files) ----------------

export interface OrderEntry { ref: string; dur?: number }
export interface V1Edit { row: string; col: Col; mode: 'replace' | 'append'; lines: string[] }
export interface RoleChange { row: string; from: string; to: string }

export interface ServiceInput {
  include: boolean;
  start?: string;
  /** 사회, 설교, 인도, 나래이션, PD, FD, 음향, 조명, 자막, 방송실, 카메라 ... */
  people: Record<string, string>;
  vocals?: number;
  leaders?: number;
  /** scalar tokens: 봉헌위원, 분병분잔, 특순, 영상이름 ... */
  values: Record<string, string>;
  /** list tokens: 찬양, 찬양1, 찬양2, 본문, 설교제목, 봉헌찬양, 축도찬양, 마무리찬양 ... */
  lists: Record<string, string[]>;
  /** explicit on/off per special; undefined = automatic (guideline) */
  specials: Record<string, boolean | undefined>;
  order?: OrderEntry[];
  durations?: Record<string, number>;
  roles?: RoleChange[];
  edits?: V1Edit[];
  headerVideos?: string[];
}

export interface WeekInput {
  version: 1;
  date: string; // YYYY-MM-DD
  services: Record<string, ServiceInput>;
}

// ---------------- output ----------------

/** Where a finished line came from, so a preview edit can be written back to the field. */
export type LineSrc = { list: string; i: number; fmt: string } | { tpl: string };
export interface OutLine { text: string; bold?: boolean; src?: LineSrc }
export type Severity = 'info' | 'warn';
export interface Warning { level: Severity; row?: string; text: string }

export interface SheetRow {
  key: string;
  name: string;
  dur: number;
  ruleDur: number | null;
  start: string;
  time: string[];
  cells: Record<Col, OutLine[]>;
  source: Source;
  flags: string[];
  shade?: string;
  /** special that added this row */
  special?: string;
  /** added by the user (순서 추가) */
  custom?: boolean;
  /** fill-in tokens used by this row */
  fields: { lists: string[]; values: string[] };
}

export interface Sheet {
  serviceId: string;
  label: string;
  title: string;
  date: string;
  dateText: string;
  fileBase: string;
  template: string;
  cols: Col[];
  rehearsal: { time: string[]; cells: Record<string, OutLine[]> };
  rows: SheetRow[];
  end: string;
  header: { staff: string[]; cast: string[]; mics: string[]; videos: string[] };
  specials: { id: string; label: string; enabled: boolean; auto: boolean; source: Source }[];
  warnings: Warning[];
  prep: string[];
  /** rows taken out (되살리기) */
  removed: { key: string; name: string }[];
  /** edit id → every line change found its anchor */
  editStatus: Record<string, boolean>;
}
