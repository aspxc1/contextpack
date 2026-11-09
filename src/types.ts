export interface Rules {
  include?: string[]; exclude?: string[]; pin?: string[]; focus?: string[];
  budget?: number; maxFileBytes?: number; out?: string; instructions?: string;
  profile?: string; task?: string;
}
export interface Options extends Rules {
  include: string[]; exclude: string[]; pin: string[]; focus: string[];
  budget: number; maxFileBytes: number; instructions: string; task: string;
}
export interface Decision {
  path: string; status: 'eligible' | 'excluded' | 'included' | 'omitted'; reason: string;
  reasons?: string[]; score?: number; bytes?: number; characters?: number; tokens?: number; hash?: string;
}
export interface CapturedFile {
  path: string; content: string; bytes: number; characters: number; hash: string; tokens: number;
  pinned: boolean; score: number; reasons: string[];
}
export interface Snapshot {
  label: string; git: { head: string | null; dirty: boolean } | null;
  files: CapturedFile[]; decisions: Decision[];
}
export interface PackResult { context: string; manifest: Record<string, any>; }
export type Scanner = (text: string) => Promise<boolean>;
