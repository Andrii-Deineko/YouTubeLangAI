export interface Json3Seg {
  utf8: string;
  tOffsetMs?: number;
  acAsrConf?: number;
}

export interface Json3Event {
  tStartMs: number;
  dDurationMs?: number;
  id?: number;
  wpWinPosId?: number;
  wsWinStyleId?: number;
  wWinId?: number;
  aAppend?: number;
  segs?: Json3Seg[];
}

export interface Json3Response {
  wireMagic?: string;
  events?: Json3Event[];
}

export interface WordToken {
  id: string;
  text: string;
  isWord: boolean;
  startTime: number;
  endTime: number;
  normalized: string;
}

export interface SubtitleCue {
  id: string;
  index: number;
  startTime: number;
  endTime: number;
  text: string;
  tokens: WordToken[];
}

export interface TrackMetadata {
  videoId: string;
  lang: string;
  tlang?: string;
  kind?: string;
  isAsr: boolean;
  url: string;
}
