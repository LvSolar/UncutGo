export type InputMode = "title" | "douban-url";

export type VersionTag =
  | "director-cut"
  | "festival"
  | "international"
  | "mainland"
  | "extended"
  | "restored"
  | "unknown";

export type VerdictLabel =
  | "大概率无删减"
  | "可能无删减"
  | "版本不一致"
  | "可能删减"
  | "疑似删减"
  | "信息不足";

export interface MovieVersion {
  id: string;
  label: string;
  durationSeconds: number;
  source: string;
  tag: VersionTag;
  notes?: string;
}

export interface PlatformOffer {
  id: string;
  platform: string;
  available: boolean;
  url: string;
  durationSeconds?: number;
  durationLabel?: string;
  notes?: string;
  matchedVersionId?: string;
}

export interface MovieRecord {
  id: string;
  inputHints: string[];
  title: string;
  originalTitle: string;
  year: number;
  director: string;
  doubanRating: number;
  doubanUrl: string;
  posterUrl?: string;
  summary: string;
  versions: MovieVersion[];
  platforms: PlatformOffer[];
}

export interface CandidateMovie {
  id: string;
  title: string;
  originalTitle: string;
  year: number;
  director: string;
  doubanRating?: number;
  doubanUrl: string;
  posterUrl?: string;
}

export interface MoviePreview {
  id: string;
  title: string;
  originalTitle: string;
  year: number;
  director: string;
  doubanRating: number;
  doubanUrl: string;
  summary: string;
  posterUrl?: string;
}

export interface JudgedPlatformOffer extends PlatformOffer {
  deltaSeconds?: number;
  verdict: VerdictLabel;
  reason: string;
}

export interface AnalysisReport {
  movie: MovieRecord;
  preferredVersion: MovieVersion;
  alternateVersions: MovieVersion[];
  platforms: JudgedPlatformOffer[];
  generatedAt: string;
  caution?: string;
  status: "mock" | "live";
  cache?: "hit" | "miss";
}
