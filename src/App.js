import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* =========================================================
   배포용 최종본
   - THAT 입력칸 공백 보존
   - 이름 입력칸 UX 개선
   - 완료/완료진행 시제 교사 토글
   - 교사용 설정 접기/펼치기
   - 저장/CSV/필터/정렬
   - 모바일 화면 대응
========================================================= */

const PROPER_NOUNS = [
  "Kim",
  "Tom",
  "Seoul",
  "Korea",
  "English",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const LS_KEY = "sentence_pattern_app_deploy_final_v5_let_wonder";
const FONT_STACK = "system-ui, -apple-system, Segoe UI, Roboto, Arial";

/* =========================================================
   0) 입력/출력 정규화
========================================================= */
function normalizeSentenceCase(sentence, properNouns = PROPER_NOUNS) {
  if (!sentence) return "";
  const m = sentence.trim().match(/^(.*?)([.?!])?$/);
  const core = (m?.[1] ?? "").trim();
  const punct = m?.[2] ?? "";

  let s = core.toLowerCase();
  s = s.replace(/\bi\b/g, "I");

  for (const pn of properNouns) {
    const re = new RegExp(`\\b${pn.toLowerCase()}\\b`, "g");
    s = s.replace(re, pn);
  }

  if (s.length > 0) s = s[0].toUpperCase() + s.slice(1);
  return (s + punct).trim();
}

function sanitizeLooseText(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

function sanitizeKeepSpaces(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ");
}

function compactLetters(text) {
  return sanitizeLooseText(text).replace(/\s+/g, "");
}

function looksLikeLetterSpacedEnglish(text) {
  const raw = sanitizeKeepSpaces(text).trim();
  if (!raw) return false;

  const pieces = raw.split(/\s+/).filter(Boolean);
  if (pieces.length < 3) return false;

  const compact = pieces.join("");
  if (!/^[A-Za-z.?!,'"-]+$/.test(compact)) return false;
  return pieces.every((p) => /^[A-Za-z]$/.test(p));
}

function normalizeEnglishField(text) {
  const raw = sanitizeLooseText(text);
  if (!raw) return "";

  if (looksLikeLetterSpacedEnglish(raw)) {
    return raw.replace(/\s+/g, "");
  }

  return raw.replace(/\s+/g, " ");
}

/* THAT 전용: 공백 유지 */
function normalizeThatClauseKeepSpaces(text) {
  const raw = sanitizeKeepSpaces(text);
  if (!raw) return "";

  if (looksLikeLetterSpacedEnglish(raw)) {
    const compact = raw.replace(/\s+/g, "");
    if (/^that/i.test(compact)) {
      return compact.replace(/^that/i, "that ");
    }
    return compact;
  }

  return raw;
}

function cleanSubjectText(text) {
  const raw = sanitizeLooseText(text);
  const compact = compactLetters(raw).toLowerCase();

  if (compact === "i") return "I";
  if (compact === "you") return "you";
  if (compact === "we") return "we";
  if (compact === "they") return "they";
  if (compact === "he") return "he";
  if (compact === "she") return "she";
  if (compact === "it") return "it";
  if (compact === "who") return "who";
  if (compact === "what") return "what";
  if (compact === "which") return "which";

  return raw.replace(/\s+/g, " ");
}

/*
   이름 전용 정리 함수
   핵심: 입력 중에는 이 함수를 쓰지 않습니다.
   한글 입력기(IME)가 조합 중일 때 값을 강제로 바꾸면
   글자 사이 공백/깨짐이 생길 수 있으므로, 저장·blur 시점에만 정리합니다.
*/
function normalizeStudentName(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/([가-힣])\s+(?=[가-힣])/g, "$1")
    .trim();
}

/* 입력 중 원문을 최대한 보존하되, 보이지 않는 문자만 제거 */
function preserveTypingText(text) {
  return String(text ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ");
}

/* =========================================================
   1) 패턴 / 슬롯
========================================================= */
const SLOT_LABEL = {
  S: "S (주어)",
  V: "V (동사)",
  O: "O (목적어/대상)",
  IO: "IO (간접목적어/사람)",
  DO: "DO (직접목적어/사물)",
  SC: "SC (주격보충어)",
  OC: "OC (목적격보충어)",
  TO_V: "TO-V (to + 동사원형)",
  VING: "V-ing (동명사/현재분사)",
  THAT: "THAT (that절)",
  IF_WHETHER: "WHETHER/IF (whether/if절)",
  WH_CLAUSE: "WH-CLAUSE (의문사절)",
  BARE: "Bare (동사원형)",
  VED: "V-ed (과거분사)",
  MOD: "MOD (수식어구: 선택)",
};

const PATTERNS = {
  SV_BE_EXIST: {
    name: "1형식(be: 있다)",
    slots: ["S", "V", "MOD"],
    required: ["S", "MOD"],
    hint: "S + be + (장소/시간) MOD",
  },
  SVC_BE_ID: {
    name: "2형식(be: 이다)",
    slots: ["S", "V", "SC", "MOD"],
    required: ["S", "SC"],
    hint: "S + be + SC(명/형)",
  },
  SVC: {
    name: "2형식(일반 SVC)",
    slots: ["S", "V", "SC", "MOD"],
    required: ["S", "SC"],
    hint: "S + V + SC (+ MOD)",
  },
  SV: {
    name: "1형식",
    slots: ["S", "V", "MOD"],
    required: ["S"],
    hint: "S + V (+ MOD)",
  },
  SVO_N: {
    name: "3형식(명사 목적어)",
    slots: ["S", "V", "O", "MOD"],
    required: ["S", "O"],
    hint: "S + V + O (+ MOD)",
  },
  SVO_TO_V: {
    name: "3형식(to-V 목적어)",
    slots: ["S", "V", "TO_V", "MOD"],
    required: ["S", "TO_V"],
    hint: "S + V + to-V (+ MOD)",
  },
  SVO_VING: {
    name: "3형식(V-ing 목적어)",
    slots: ["S", "V", "VING", "MOD"],
    required: ["S", "VING"],
    hint: "S + V + V-ing (+ MOD)",
  },
  SVO_THAT: {
    name: "3형식(that절 목적어)",
    slots: ["S", "V", "THAT", "MOD"],
    required: ["S", "THAT"],
    hint: "S + V + that절 (+ MOD)",
  },
  SVO_IF_WHETHER: {
    name: "3형식(whether/if절 목적어)",
    slots: ["S", "V", "IF_WHETHER", "MOD"],
    required: ["S", "IF_WHETHER"],
    hint: "S + V + whether/if절 (+ MOD)",
  },
  SVO_WH_CLAUSE: {
    name: "3형식(의문사절 목적어)",
    slots: ["S", "V", "WH_CLAUSE", "MOD"],
    required: ["S", "WH_CLAUSE"],
    hint: "S + V + 의문사절 (+ MOD)",
  },
  SVOO: {
    name: "4형식",
    slots: ["S", "V", "IO", "DO", "MOD"],
    required: ["S", "IO", "DO"],
    hint: "S + V + IO + DO (+ MOD)",
  },
  SVOC_N_ADJ: {
    name: "5형식(OC: 명/형)",
    slots: ["S", "V", "O", "OC", "MOD"],
    required: ["S", "O", "OC"],
    hint: "S + V + O + OC (+ MOD)",
  },
  SVOC_ADJ: {
    name: "5형식(OC: 형용사)",
    slots: ["S", "V", "O", "OC", "MOD"],
    required: ["S", "O", "OC"],
    hint: "S + V + O + OC(형용사) (+ MOD)",
  },
  SVOC_TO_V: {
    name: "5형식(OC: to-V)",
    slots: ["S", "V", "O", "TO_V", "MOD"],
    required: ["S", "O", "TO_V"],
    hint: "S + V + O + to-V (+ MOD)",
  },
  SVOC_BARE: {
    name: "5형식(OC: bare)",
    slots: ["S", "V", "O", "BARE", "MOD"],
    required: ["S", "O", "BARE"],
    hint: "S + V + O + 동사원형 (+ MOD)",
  },
  SVOC_VING: {
    name: "5형식(OC: V-ing)",
    slots: ["S", "V", "O", "VING", "MOD"],
    required: ["S", "O", "VING"],
    hint: "S + V + O + V-ing (+ MOD)",
  },
  SVOC_VED: {
    name: "5형식(OC: V-ed)",
    slots: ["S", "V", "O", "VED", "MOD"],
    required: ["S", "O", "VED"],
    hint: "S + V + O + V-ed (+ MOD)",
  },
};

const LEVEL_LABEL = {
  ALL: "전체",
  G1_1: "중1 1학기",
  G1_2: "중1 2학기",
  G2: "중2",
};

const VERBS = [
  {
    key: "be",
    level: "G1_1",
    patterns: { SV_BE_EXIST: "있다/존재하다", SVC_BE_ID: "이다/상태이다" },
  },
  {
    key: "become",
    level: "G2",
    patterns: { SVC: "되다/…해지다", SVO_N: "어울리다" },
  },
  {
    key: "believe",
    level: "G2",
    patterns: { SVO_THAT: "믿다(that절)", SVO_N: "믿다(명사)" },
  },
  { key: "buy", level: "G1_2", patterns: { SVOO: "사주다", SVO_N: "사다" } },
  {
    key: "call",
    level: "G2",
    patterns: { SVOC_N_ADJ: "부르다/칭하다", SVO_N: "전화하다" },
  },
  { key: "close", level: "G1_1", patterns: { SVO_N: "닫다" } },
  {
    key: "come",
    level: "G1_1",
    patterns: { SV: "오다", SVC: "…이 되다/…해지다" },
  },
  {
    key: "decide",
    level: "G2",
    patterns: {
      SVO_N: "결정하다",
      SVO_TO_V: "결정하다(to-V)",
      SVO_THAT: "결정/판단하다(that절)",
    },
  },
  { key: "drink", level: "G1_1", patterns: { SVO_N: "마시다" } },
  { key: "eat", level: "G1_1", patterns: { SVO_N: "먹다" } },
  {
    key: "enjoy",
    level: "G2",
    patterns: { SVO_N: "즐기다", SVO_VING: "즐기다(V-ing)" },
  },
  {
    key: "feel",
    level: "G1_2",
    patterns: {
      SVO_N: "느끼다",
      SVO_THAT: "…라고 느끼다",
      SVOC_BARE: "…하는 것을 느끼다",
      SVOC_VING: "…하는 것을 느끼다(V-ing)",
      SVC: "…하게 느끼다",
    },
  },
  {
    key: "find",
    level: "G2",
    patterns: { SVO_N: "찾다", SVOC_N_ADJ: "발견하다(~한 상태로)" },
  },
  {
    key: "finish",
    level: "G2",
    patterns: { SVO_VING: "끝내다(V-ing)", SVO_N: "끝내다(명사)" },
  },
  {
    key: "get",
    level: "G1_2",
    patterns: {
      SVO_N: "얻다/받다",
      SVOO: "가져다주다",
      SVOC_TO_V: "~가 …하도록 하다",
      SVOC_BARE: "~가 …하게 하다",
      SVOC_VED: "~을 …되게/당하게 하다",
    },
  },
  {
    key: "give",
    level: "G1_2",
    patterns: { SVOO: "주다", SVO_N: "주다(3형식)" },
  },
  {
    key: "go",
    level: "G1_1",
    patterns: { SV: "가다", SVC: "…해지다/…이 되다" },
  },
  {
    key: "have",
    level: "G1_1",
    patterns: {
      SVO_N: "가지다",
      SVOC_BARE: "~에게 …하게 하다",
      SVOC_VED: "~을 …되게/당하게 하다",
    },
  },
  {
    key: "hear",
    level: "G2",
    patterns: {
      SVO_N: "듣다",
      SVOC_VING: "…하는 것을 듣다",
      SVOC_BARE: "…하는 것을 듣다(bare)",
    },
  },
  {
    key: "help",
    level: "G1_2",
    patterns: {
      SVO_N: "돕다",
      SVOC_TO_V: "~가 …하는 것을 돕다",
      SVOC_BARE: "~가 …하는 것을 돕다(bare)",
    },
  },
  {
    key: "hope",
    level: "G2",
    patterns: {
      SVO_TO_V: "희망하다(to-V)",
      SVO_THAT: "희망/바라다(that절)",
      SVOC_TO_V: "O가 …하기를 바라다",
    },
  },
  {
    key: "keep",
    level: "G2",
    patterns: {
      SVC: "…하게 유지하다",
      SVO_N: "계속 가지고 있다",
      SVO_VING: "계속하다(V-ing)",
      SVOC_N_ADJ: "~한 상태로 유지하다",
    },
  },
  {
    key: "know",
    level: "G2",
    patterns: { SVO_THAT: "알다(that절)", SVO_N: "알다(명사)" },
  },
  {
    key: "learn",
    level: "G2",
    patterns: { SVO_N: "배우다", SVO_TO_V: "…하는 것을 배우다" },
  },
  {
    key: "let",
    level: "G2",
    patterns: {
      SVO_N: "세 놓다/임대하다(3형식)",
      SVOC_BARE: "O가 …하게 허락하다/시키다(5형식 bare infinitive)",
    },
  },
  {
    key: "leave",
    level: "G1_2",
    patterns: {
      SV: "떠나다",
      SVO_N: "남기다",
      SVOC_ADJ: "~을 ~한 상태로 두다",
    },
  },
  {
    key: "like",
    level: "G1_1",
    patterns: {
      SVO_N: "좋아하다",
      SVO_TO_V: "…하는 것을 좋아하다(to-V)",
      SVO_VING: "…하는 것을 좋아하다(V-ing)",
    },
  },
  {
    key: "listen",
    level: "G1_2",
    patterns: {
      SV: "듣다(listen to)",
      SVOC_BARE: "…하는 것을 주의깊게 듣다",
      SVOC_VING: "…하는 것을 주의깊게 듣다(V-ing)",
    },
  },
  {
    key: "live",
    level: "G1_1",
    patterns: { SV: "살다", SVO_N: "삶/생활을 살다" },
  },
  { key: "look", level: "G1_2", patterns: { SVC: "…처럼 보이다" } },
  {
    key: "make",
    level: "G2",
    patterns: {
      SV: "드문 용법",
      SVC: "드문 용법",
      SVO_N: "만들다",
      SVOO: "만들어 주다",
      SVOC_N_ADJ: "~하게/…로 만들다",
      SVOC_BARE: "~시키다",
      SVOC_VED: "~당하게 하다",
    },
  },
  { key: "meet", level: "G1_2", patterns: { SVO_N: "만나다" } },
  {
    key: "need",
    level: "G1_2",
    patterns: { SVO_N: "필요로 하다", SVO_TO_V: "…해야 한다(to-V)" },
  },
  { key: "open", level: "G1_1", patterns: { SVO_N: "열다" } },
  {
    key: "plan",
    level: "G2",
    patterns: { SVO_TO_V: "계획하다(to-V)", SVO_N: "계획하다(명사)" },
  },
  {
    key: "practice",
    level: "G2",
    patterns: { SVO_VING: "연습하다(V-ing)", SVO_N: "연습하다(명사)" },
  },
  { key: "read", level: "G1_2", patterns: { SVO_N: "읽다" } },
  { key: "run", level: "G2", patterns: { SV: "달리다", SVO_N: "운영하다" } },
  {
    key: "say",
    level: "G2",
    patterns: { SVO_THAT: "말하다(that절)", SVO_N: "말하다(명사)" },
  },
  {
    key: "see",
    level: "G1_2",
    patterns: {
      SVO_N: "보다",
      SVOC_VING: "…하는 것을 보다",
      SVOC_BARE: "…하는 것을 보다(bare)",
    },
  },
  { key: "send", level: "G1_2", patterns: { SVOO: "보내다" } },
  { key: "show", level: "G1_2", patterns: { SVOO: "보여주다" } },
  { key: "sleep", level: "G1_1", patterns: { SV: "잠자다" } },
  { key: "smile", level: "G1_1", patterns: { SV: "미소 짓다" } },
  {
    key: "speak",
    level: "G1_2",
    patterns: { SVO_N: "말하다(주제/언어)", SV: "말하다(자동사)" },
  },
  {
    key: "start",
    level: "G1_2",
    patterns: { SVO_N: "시작하다", SVO_TO_V: "시작하다(to-V)" },
  },
  { key: "stop", level: "G2", patterns: { SVO_VING: "그만두다(V-ing)" } },
  {
    key: "study",
    level: "G1_1",
    patterns: { SV: "공부하다", SVO_N: "공부하다(과목/내용)" },
  },
  {
    key: "tell",
    level: "G1_2",
    patterns: {
      SVOO: "말해주다",
      SVO_THAT: "말하다(that절)",
      SVOC_TO_V: "~에게 …하도록 지시하다",
    },
  },
  {
    key: "think",
    level: "G2",
    patterns: {
      SVO_THAT: "생각하다(that절)",
      SVO_N: "생각하다(명사)",
      SVO_TO_V: "…하려고 생각하다",
      SVOC_TO_V: "O가 …한다고 생각하다",
    },
  },
  { key: "use", level: "G1_2", patterns: { SVO_N: "사용하다" } },
  {
    key: "walk",
    level: "G1_1",
    patterns: { SV: "걷다", SVO_N: "~을 걷다/산책시키다" },
  },
  {
    key: "watch",
    level: "G1_1",
    patterns: {
      SVO_N: "보다(시청)",
      SVOC_BARE: "…하는 것을 지켜보다",
      SVOC_VING: "…하는 것을 지켜보다(V-ing)",
    },
  },
  {
    key: "want",
    level: "G1_2",
    patterns: {
      SVO_N: "원하다",
      SVO_TO_V: "원하다(to-V)",
      SVOC_TO_V: "O가 ~하기를 원하다",
    },
  },
  {
    key: "wonder",
    level: "G2",
    patterns: {
      SVO_IF_WHETHER: "궁금해하다(whether/if절)",
      SVO_WH_CLAUSE: "궁금해하다(의문사절)",
    },
  },
  {
    key: "paint",
    level: "G2",
    patterns: { SVO_N: "색칠하다", SVOC_N_ADJ: "~을 ~한 색으로 색칠하다" },
  },
].sort((a, b) => a.key.localeCompare(b.key));

/* =========================================================
   2) 문법 보조
========================================================= */
const MODALS = [
  { key: "", label: "(없음)" },
  { key: "can", label: "can" },
  { key: "could", label: "could" },
  { key: "should", label: "should" },
  { key: "must", label: "must" },
  { key: "may", label: "may" },
  { key: "might", label: "might" },
  { key: "would", label: "would" },
];

const TENSE_OPTIONS_BASE = [
  { key: "present", label: "현재" },
  { key: "past", label: "과거" },
  { key: "future", label: "미래" },
  { key: "present_cont", label: "현재진행" },
  { key: "past_cont", label: "과거진행" },
  { key: "future_cont", label: "미래진행" },
];

const TENSE_OPTIONS_PERFECT = [
  { key: "present_perfect", label: "현재완료" },
  { key: "past_perfect", label: "과거완료" },
  { key: "future_perfect", label: "미래완료" },
  { key: "present_perfect_cont", label: "현재완료진행" },
  { key: "past_perfect_cont", label: "과거완료진행" },
  { key: "future_perfect_cont", label: "미래완료진행" },
];

const MODE_OPTIONS = [
  { key: "affirm", label: "평서" },
  { key: "negative", label: "부정" },
  { key: "question", label: "의문" },
  { key: "neg_question", label: "의문부정" },
  { key: "why_not", label: "Why not" },
];

const COLLECTIVE_NOUNS = new Set([
  "family",
  "team",
  "staff",
  "group",
  "committee",
  "class",
  "company",
  "government",
  "audience",
  "crowd",
]);
const ALWAYS_PLURAL_HEADS = new Set([
  "people",
  "children",
  "men",
  "women",
  "police",
]);
const WH_SUBJECT_WORDS = new Set(["who", "what", "which"]);
const WH_ADVERB_WORDS = new Set(["when", "where", "why", "how"]);
const COGNITIVE_THAT_VERBS = new Set([
  "think",
  "believe",
  "know",
  "say",
  "feel",
]);

const IRREGULAR = {
  be: { past: "was", s: "is", pp: "been" },
  have: { past: "had", s: "has", pp: "had" },
  do: { past: "did", s: "does", pp: "done" },
  go: { past: "went", s: "goes", pp: "gone" },
  run: { past: "ran", s: "runs", pp: "run" },
  buy: { past: "bought", s: "buys", pp: "bought" },
  make: { past: "made", s: "makes", pp: "made" },
  eat: { past: "ate", s: "eats", pp: "eaten" },
  drink: { past: "drank", s: "drinks", pp: "drunk" },
  give: { past: "gave", s: "gives", pp: "given" },
  send: { past: "sent", s: "sends", pp: "sent" },
  tell: { past: "told", s: "tells", pp: "told" },
  think: { past: "thought", s: "thinks", pp: "thought" },
  say: { past: "said", s: "says", pp: "said" },
  know: { past: "knew", s: "knows", pp: "known" },
  feel: { past: "felt", s: "feels", pp: "felt" },
  meet: { past: "met", s: "meets", pp: "met" },
  read: { past: "read", s: "reads", pp: "read" },
  become: { past: "became", s: "becomes", pp: "become" },
  find: { past: "found", s: "finds", pp: "found" },
  hear: { past: "heard", s: "hears", pp: "heard" },
  see: { past: "saw", s: "sees", pp: "seen" },
  speak: { past: "spoke", s: "speaks", pp: "spoken" },
  come: { past: "came", s: "comes", pp: "come" },
  leave: { past: "left", s: "leaves", pp: "left" },
  let: { past: "let", s: "lets", pp: "let" },
  wonder: { past: "wondered", s: "wonders", pp: "wondered" },
  write: { past: "wrote", s: "writes", pp: "written" },
};

function lastWordLower(text) {
  const parts = sanitizeLooseText(text).toLowerCase().split(/\s+/);
  return parts[parts.length - 1] || "";
}
function firstWordLower(text) {
  return sanitizeLooseText(text).split(/\s+/)[0]?.toLowerCase() || "";
}
function firstTwoWordsLower(text) {
  return sanitizeLooseText(text)
    .split(/\s+/)
    .slice(0, 2)
    .join(" ")
    .toLowerCase();
}
function looksLikePluralByForm(subjectText) {
  const s = sanitizeLooseText(subjectText).toLowerCase();
  if (!s) return false;
  if (s.includes(" and ")) return true;
  const last = lastWordLower(s);
  if (ALWAYS_PLURAL_HEADS.has(last)) return true;
  if (last.endsWith("s") && !["his", "this"].includes(last)) return true;
  return false;
}
function isCollectiveSubject(subjectText) {
  const s = sanitizeLooseText(subjectText).toLowerCase();
  if (!s) return false;
  return COLLECTIVE_NOUNS.has(lastWordLower(s));
}
function isThirdSingular(subjectText, collectiveStyle = "US") {
  const s = cleanSubjectText(subjectText).toLowerCase();
  if (!s) return false;
  if (["i", "you", "we", "they"].includes(s)) return false;
  if (s.includes(" and ")) return false;
  if (looksLikePluralByForm(subjectText)) return false;
  if (isCollectiveSubject(subjectText)) return collectiveStyle === "US";
  return true;
}

function conjVerb(
  base,
  tense,
  subjectText,
  collectiveStyle = "US",
  allowSubjunctiveIwere = false
) {
  if (!base) return "";
  const s = cleanSubjectText(subjectText).toLowerCase();
  const third = isThirdSingular(subjectText, collectiveStyle);

  if (base === "be") {
    if (tense === "past") {
      if (s === "i") return allowSubjunctiveIwere ? "were" : "was";
      if (!third) return "were";
      return "was";
    }
    if (s === "i") return "am";
    if (third) return "is";
    return "are";
  }

  const irr = IRREGULAR[base];
  if (tense === "past") {
    if (irr?.past) return irr.past;
    if (base.endsWith("e")) return `${base}d`;
    if (base.endsWith("y") && !"aeiou".includes(base[base.length - 2]))
      return `${base.slice(0, -1)}ied`;
    return `${base}ed`;
  }

  if (!isThirdSingular(subjectText, collectiveStyle)) return base;
  if (irr?.s) return irr.s;
  if (base.endsWith("y") && !"aeiou".includes(base[base.length - 2]))
    return `${base.slice(0, -1)}ies`;
  if (/(s|sh|ch|x|z|o)$/.test(base)) return `${base}es`;
  return `${base}s`;
}

function toPastParticiple(base) {
  const v = (base || "").toLowerCase();
  if (!v) return "";
  const irr = IRREGULAR[v];
  if (irr?.pp) return irr.pp;
  if (v.endsWith("e")) return `${v}d`;
  if (v.endsWith("y") && !"aeiou".includes(v[v.length - 2]))
    return `${v.slice(0, -1)}ied`;
  return `${v}ed`;
}

function toIng(base) {
  const v = (base || "").toLowerCase();
  if (!v) return v;
  const special = {
    make: "making",
    have: "having",
    run: "running",
    sit: "sitting",
    swim: "swimming",
    lie: "lying",
    die: "dying",
    write: "writing",
  };
  if (special[v]) return special[v];
  if (v.endsWith("ie")) return `${v.slice(0, -2)}ying`;
  if (v.endsWith("e") && v !== "be") return `${v.slice(0, -1)}ing`;
  return `${v}ing`;
}

function beFormForProgressive(
  tense,
  subjectText,
  collectiveStyle = "US",
  allowSubjunctiveIwere = false
) {
  const s = cleanSubjectText(subjectText).toLowerCase();
  const third = isThirdSingular(subjectText, collectiveStyle);
  if (tense === "past_cont") {
    if (s === "i") return allowSubjunctiveIwere ? "were" : "was";
    if (!third) return "were";
    return "was";
  }
  if (s === "i") return "am";
  if (third) return "is";
  return "are";
}

function haveFormForPerfect(tense, subjectText, collectiveStyle = "US") {
  const s = cleanSubjectText(subjectText).toLowerCase();
  if (["past_perfect", "past_perfect_cont"].includes(tense)) return "had";
  if (["future_perfect", "future_perfect_cont"].includes(tense)) return "have";
  if (["i", "you", "we", "they"].includes(s)) return "have";
  return isThirdSingular(subjectText, collectiveStyle) ? "has" : "have";
}

function getStrictDoAux(subjectText, tense, collectiveStyle = "US") {
  const s = cleanSubjectText(subjectText).toLowerCase();
  if (tense === "past") return "Did";
  if (["i", "you", "we", "they"].includes(s)) return "Do";
  if (["he", "she", "it"].includes(s)) return "Does";
  return isThirdSingular(subjectText, collectiveStyle) ? "Does" : "Do";
}

function isWhSubject(text) {
  const w1 = firstWordLower(text);
  const w2 = firstTwoWordsLower(text);
  return WH_SUBJECT_WORDS.has(w1) || w2 === "how many" || w2 === "how much";
}

function isWhAdverb(text) {
  const w2 = firstTwoWordsLower(text);
  if (w2 === "how many" || w2 === "how much") return false;
  return WH_ADVERB_WORDS.has(firstWordLower(text));
}

function scLooksLikeNoun(sc) {
  const t = sanitizeLooseText(sc).toLowerCase();
  return t.startsWith("a ") || t.startsWith("an ") || t.startsWith("the ");
}

function extractTrailingWhFromToV(toVText) {
  const t = normalizeEnglishField(toVText || "");
  if (!t) return null;
  const m = t.match(/^to\s+(.+?)\s+(who|what|which)$/i);
  if (m) return { wh: m[2].toLowerCase(), rest: `to ${m[1]}` };
  return null;
}

function contractNot(auxOrBe, useContraction) {
  if (!useContraction) return [auxOrBe, "not"];
  const x = (auxOrBe || "").toLowerCase();
  if (x === "is") return ["isn't"];
  if (x === "are") return ["aren't"];
  if (x === "was") return ["wasn't"];
  if (x === "were") return ["weren't"];
  if (x === "do") return ["don't"];
  if (x === "does") return ["doesn't"];
  if (x === "did") return ["didn't"];
  if (x === "have") return ["haven't"];
  if (x === "has") return ["hasn't"];
  if (x === "had") return ["hadn't"];
  if (x === "will") return ["won't"];
  return [auxOrBe, "not"];
}

function shouldUseNaturalThatQuestion({ verb, patternId, mode }) {
  if (patternId !== "SVO_THAT") return false;
  if (!(mode === "question" || mode === "neg_question")) return false;
  return COGNITIVE_THAT_VERBS.has(verb);
}

function validateShape(patternId, slots) {
  if (patternId.includes("TO_V")) {
    const tv = normalizeEnglishField(slots.TO_V || "").toLowerCase();
    if (!tv.startsWith("to "))
      return 'TO-V는 "to + 동사원형"으로 시작해야 해요. 예) to go';
  }
  if (patternId === "SVO_VING" || patternId === "SVOC_VING") {
    const ing = normalizeEnglishField(slots.VING || "").toLowerCase();
    const first = ing.split(/\s+/)[0] || "";
    if (!first.endsWith("ing"))
      return "V-ing는 동사+ing 형태로 시작하면 좋아요. 예) playing";
  }
  if (patternId === "SVO_THAT") {
    const thatc = sanitizeKeepSpaces(slots.THAT || "");
    if (!thatc.trim().toLowerCase().startsWith("that ")) {
      return 'that절은 "that + 문장"으로 시작하면 좋아요.';
    }
  }
  if (patternId === "SVO_IF_WHETHER") {
    const clause = sanitizeKeepSpaces(slots.IF_WHETHER || "")
      .trim()
      .toLowerCase();
    if (!(clause.startsWith("whether ") || clause.startsWith("if "))) {
      return 'whether/if절은 "whether + 주어 + 동사" 또는 "if + 주어 + 동사"로 시작하면 좋아요. 예) whether he is coming';
    }
  }
  if (patternId === "SVO_WH_CLAUSE") {
    const clause = sanitizeKeepSpaces(slots.WH_CLAUSE || "")
      .trim()
      .toLowerCase();
    if (!/^(who|what|when|where|why|how|which|whose|whom)\b/.test(clause)) {
      return "의문사절은 who/what/when/where/why/how/which 등으로 시작하면 좋아요. 예) where I should go";
    }
  }
  if (patternId === "SVOC_BARE") {
    const bare = normalizeEnglishField(slots.BARE || "").toLowerCase();
    if (bare.startsWith("to "))
      return 'Bare infinitive는 "to" 없이 동사원형으로 시작해야 해요. 예) clean';
  }
  if (patternId === "SVOC_ADJ") {
    const oc = normalizeEnglishField(slots.OC || "").toLowerCase();
    if (oc.startsWith("a ") || oc.startsWith("an ") || oc.startsWith("the ")) {
      return "SVOC_ADJ는 OC에 명사구보다 형용사를 넣는 연습용이에요. 예) open / clean / alone";
    }
  }
  return "";
}

function explainMakeMeaning(patternId) {
  if (patternId === "SV")
    return "make 1형식(확장): 드물게 ‘해내다/성공하다’처럼 제한적으로 볼 수 있어요.";
  if (patternId === "SVC")
    return "make 2형식(확장): 일반 핵심 용법은 아니므로 교사용 보충 연습으로만 권장해요.";
  if (patternId === "SVOC_BARE")
    return "make + O + 동사원형 → ‘시키다/강제로 ~하게 하다’";
  if (patternId === "SVOC_VED")
    return "make + O + V-ed → ‘~을 …되게/당하게 하다’";
  if (patternId === "SVOC_N_ADJ")
    return "make + O + OC(형/명) → ‘~을 …하게/…로 만들다’";
  if (patternId === "SVOO") return "make 4형식 → ‘~에게 ~을 만들어 주다’";
  if (patternId === "SVO_N") return "make 3형식 → ‘만들다’";
  return "";
}

function buildFeedback({
  verb,
  tense,
  mode,
  S,
  patternId,
  modal,
  collectiveStyle,
  allowSubjunctiveIwere,
  showPerfectTense,
}) {
  const feedback = [];
  const s = cleanSubjectText(S).toLowerCase();

  if (verb === "be" && tense === "past" && s === "i") {
    feedback.push(
      allowSubjunctiveIwere
        ? "ℹ️ 가정법 허용 ON: 'I were'는 보통 If I were ... 같은 가정법에서 사용해요."
        : "✅ 과거 be 수일치: 일반 과거는 'I was'가 기본이에요. (가정법: If I were ...)"
    );
  }

  if (isCollectiveSubject(S)) {
    feedback.push(
      collectiveStyle === "US"
        ? "ℹ️ US 설정: 집합명사는 보통 단수 취급 → is/was/has"
        : "ℹ️ UK 설정: 집합명사는 복수 취급 가능 → are/were/have"
    );
  }

  if (modal && ["present_cont", "past_cont", "future_cont"].includes(tense)) {
    feedback.push(
      "ℹ️ modal + 진행형은 'modal + be + V-ing' 형태예요. 예) can be studying"
    );
  }

  if (
    modal &&
    [
      "present_perfect",
      "past_perfect",
      "future_perfect",
      "present_perfect_cont",
      "past_perfect_cont",
      "future_perfect_cont",
    ].includes(tense)
  ) {
    feedback.push(
      "ℹ️ 이 앱에서는 완료/완료진행과 modal을 함께 쓰는 복합 구조는 단순화를 위해 제한했어요."
    );
  }

  if (mode === "why_not" && verb === "be")
    feedback.push(
      "ℹ️ Why not + be ...? 도 가능하지만, 보통 Why not + 일반동사로 더 자연스러워요."
    );
  if (mode === "question" && verb === "be" && patternId === "SVC_BE_ID")
    feedback.push(
      "✅ How + 형용사 의문문: 'How smart is she?'처럼 형용사를 앞으로 보낼 수 있어요."
    );
  if (shouldUseNaturalThatQuestion({ verb, patternId, mode }))
    feedback.push(
      "✅ think/believe/know/say + that절 의문문은 Do/Does/Did + 주어 + think... 가 더 자연스러워요."
    );
  if (verb === "make" && ["SV", "SVC"].includes(patternId))
    feedback.push(
      "⚠️ make의 1형식/2형식은 일반 핵심 용법이 아니어서 자연스러운 예문 범위가 좁아요."
    );

  if (verb === "let" && patternId === "SVOC_BARE")
    feedback.push(
      "✅ let + O + 동사원형 → ‘O가 ~하게 허락하다/하게 하다’라는 뜻이에요. 예) My mom lets me play soccer."
    );

  if (verb === "let" && patternId === "SVO_N")
    feedback.push(
      "ℹ️ let + O는 ‘집/방/물건 등을 세 놓다, 임대하다’라는 뜻으로 쓸 수 있어요."
    );

  if (verb === "wonder" && patternId === "SVO_IF_WHETHER")
    feedback.push(
      "✅ wonder + whether/if절 → ‘~인지 궁금해하다’라는 뜻이에요. 예) I wonder whether he is coming."
    );

  if (verb === "wonder" && patternId === "SVO_WH_CLAUSE")
    feedback.push(
      "✅ wonder + 의문사절 → ‘무엇/어디/왜/어떻게 ~인지 궁금해하다’라는 뜻이에요. 예) I wonder where I should go."
    );

  if (showPerfectTense) {
    if (tense === "present_perfect")
      feedback.push("ℹ️ 현재완료: have/has + p.p.");
    if (tense === "past_perfect") feedback.push("ℹ️ 과거완료: had + p.p.");
    if (tense === "future_perfect")
      feedback.push("ℹ️ 미래완료: will have + p.p.");
    if (tense === "present_perfect_cont")
      feedback.push("ℹ️ 현재완료진행: have/has been + V-ing");
    if (tense === "past_perfect_cont")
      feedback.push("ℹ️ 과거완료진행: had been + V-ing");
    if (tense === "future_perfect_cont")
      feedback.push("ℹ️ 미래완료진행: will have been + V-ing");
  }

  return feedback;
}

/* =========================================================
   3) 저장 / CSV
========================================================= */
function safeLoadSaved() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function scheduleIdle(fn) {
  const ric = window.requestIdleCallback;
  if (typeof ric === "function") ric(() => fn());
  else setTimeout(fn, 20);
}

function safeSaveSaved(list) {
  try {
    const payload = JSON.stringify(list);
    scheduleIdle(() => {
      try {
        localStorage.setItem(LS_KEY, payload);
      } catch {}
    });
  } catch {}
}

function escapeCSVCell(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCSV(records, filename = "영어문장_제출목록.csv") {
  if (!records?.length) {
    alert("저장된 문장이 없습니다.");
    return;
  }
  const header = [
    "반",
    "번호",
    "이름",
    "문장",
    "동사",
    "문장형식",
    "시제",
    "문장유형",
    "모달",
    "의미메모",
    "피드백",
    "저장시간",
  ];
  const lines = [
    header.map(escapeCSVCell).join(","),
    ...records.map((r) =>
      [
        r.classNo,
        r.studentNo,
        r.name,
        r.sentence,
        r.verb,
        r.patternName,
        r.tense,
        r.mode,
        r.modal || "",
        r.note,
        r.feedbackDetail || "",
        r.timeStr,
      ]
        .map(escapeCSVCell)
        .join(",")
    ),
  ];
  const csv = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =========================================================
   4) UI 스타일
========================================================= */
const shell = {
  minHeight: "100vh",
  background: "#f6f7fb",
  padding: 16,
  fontFamily: FONT_STACK,
  color: "#111827",
};
const wrap = {
  maxWidth: 1080,
  margin: "0 auto",
  display: "grid",
  gap: 16,
};
const card = {
  background: "white",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  boxShadow: "0 8px 24px rgba(0,0,0,0.05)",
  padding: 16,
};
const title = { fontSize: 24, fontWeight: 800, margin: 0 };
const sub = { marginTop: 6, fontSize: 14, color: "#6b7280" };
const label = {
  fontSize: 12,
  fontWeight: 800,
  color: "#6b7280",
  marginBottom: 6,
};
const input = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: FONT_STACK,
  fontSize: 15,
  outline: "none",
};
const select = { ...input, background: "white" };
const btn = {
  padding: "11px 14px",
  borderRadius: 999,
  border: "1px solid #d1d5db",
  background: "white",
  cursor: "pointer",
  fontWeight: 700,
};
const primaryBtn = {
  ...btn,
  background: "#111827",
  color: "white",
  border: "1px solid #111827",
};
const pill = (active) => ({
  padding: "8px 12px",
  borderRadius: 999,
  border: active ? "2px solid #111827" : "1px solid #d1d5db",
  background: active ? "#f9fafb" : "white",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13,
});
const badge = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 999,
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  fontSize: 12,
  fontWeight: 700,
};

/* =========================================================
   5) 메인 앱
========================================================= */
export default function App() {
  const [classNo, setClassNo] = useState("");
  const [studentNo, setStudentNo] = useState("");
  const [studentName, setStudentName] = useState("");

  const [levelFilter, setLevelFilter] = useState("ALL");
  const [verb, setVerb] = useState("be");
  const [patternId, setPatternId] = useState("");
  const [slots, setSlots] = useState({});
  const [tense, setTense] = useState("present");
  const [mode, setMode] = useState("affirm");
  const [modal, setModal] = useState("");
  const [message, setMessage] = useState("");

  const [saved, setSaved] = useState([]);
  const [filterClassNo, setFilterClassNo] = useState("");
  const [filterStudentNo, setFilterStudentNo] = useState("");
  const [sortKey, setSortKey] = useState("time");
  const [sortDir, setSortDir] = useState("desc");

  const [teacherModeOpen, setTeacherModeOpen] = useState(true);
  const [useContraction, setUseContraction] = useState(true);
  const [collectiveStyle, setCollectiveStyle] = useState("US");
  const [allowSubjunctiveIwere, setAllowSubjunctiveIwere] = useState(false);
  const [showPerfectTense, setShowPerfectTense] = useState(false);

  const saveTimerRef = useRef(null);

  useEffect(() => setSaved(safeLoadSaved()), []);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => safeSaveSaved(saved), 120);
    return () => clearTimeout(saveTimerRef.current);
  }, [saved]);

  useEffect(() => {
    const perfectKeys = TENSE_OPTIONS_PERFECT.map((t) => t.key);
    if (!showPerfectTense && perfectKeys.includes(tense)) setTense("present");
  }, [showPerfectTense, tense]);

  const visibleTenseOptions = useMemo(
    () => [
      ...TENSE_OPTIONS_BASE,
      ...(showPerfectTense ? TENSE_OPTIONS_PERFECT : []),
    ],
    [showPerfectTense]
  );

  const verbsFiltered = useMemo(() => {
    if (levelFilter === "ALL") return VERBS;
    return VERBS.filter((v) => v.level === levelFilter);
  }, [levelFilter]);

  const verbMeta = useMemo(
    () => VERBS.find((v) => v.key === verb) || null,
    [verb]
  );
  const allowedPatternIds = useMemo(
    () => (verbMeta ? Object.keys(verbMeta.patterns) : []),
    [verbMeta]
  );

  const onChangeVerb = useCallback((nextVerb) => {
    setVerb(nextVerb);
    setPatternId("");
    setSlots({});
    setMessage("");
  }, []);

  const onPickPattern = useCallback(
    (pid) => {
      setPatternId(pid);
      const pat = PATTERNS[pid];
      const next = {};
      for (const k of pat.slots) next[k] = "";
      next.V = verb;
      setSlots(next);
      setMessage("");
    },
    [verb]
  );

  const onChangeSlot = useCallback((key, value) => {
    setSlots((prev) => {
      // 입력 중에는 모든 슬롯의 원문을 그대로 보존합니다.
      // S/O/SC/OC/TO-V/THAT/MOD 등에서 단어 사이 공백을 자유롭게 입력할 수 있게 하기 위함입니다.
      // 문장 미리보기와 저장 단계에서만 각 슬롯별 정규화를 적용합니다.
      return { ...prev, [key]: value };
    });
  }, []);

  const meaningCard = useMemo(() => {
    if (!verbMeta || !patternId) return null;
    return {
      patternName: PATTERNS[patternId]?.name || patternId,
      meaning: verbMeta.patterns[patternId] || "",
      hint: PATTERNS[patternId]?.hint || "",
      extra: verb === "make" ? explainMakeMeaning(patternId) : "",
    };
  }, [verbMeta, patternId, verb]);

  const disableSubject = mode === "why_not";
  const isCont = ["present_cont", "past_cont", "future_cont"].includes(tense);
  const isPerfect = [
    "present_perfect",
    "past_perfect",
    "future_perfect",
  ].includes(tense);
  const isPerfectCont = [
    "present_perfect_cont",
    "past_perfect_cont",
    "future_perfect_cont",
  ].includes(tense);

  const { sentencePreviewRaw, feedbackList } = useMemo(() => {
    if (!patternId) return { sentencePreviewRaw: "", feedbackList: [] };
    const pat = PATTERNS[patternId];
    if (!pat) return { sentencePreviewRaw: "", feedbackList: [] };

    const S = cleanSubjectText(slots.S || "");
    const baseV = verb;
    const MOD_raw = sanitizeKeepSpaces(slots.MOD || "").trim();
    const O_raw = normalizeEnglishField(slots.O || "");
    const SC_raw = normalizeEnglishField(slots.SC || "");
    const TO_V_raw = normalizeEnglishField(slots.TO_V || "");
    const THAT_raw = sanitizeKeepSpaces(slots.THAT || "");

    let tailParts = pat.slots
      .filter((k) => k !== "S" && k !== "V")
      .map((k) => {
        if (k === "THAT") return THAT_raw;
        if (k === "IF_WHETHER")
          return normalizeEnglishField(slots.IF_WHETHER || "");
        if (k === "WH_CLAUSE")
          return normalizeEnglishField(slots.WH_CLAUSE || "");
        if (k === "TO_V") return TO_V_raw;
        if (k === "O") return O_raw;
        if (k === "SC") return SC_raw;
        if (k === "MOD") return MOD_raw;
        if (k === "VING") return normalizeEnglishField(slots.VING || "");
        if (k === "BARE") return normalizeEnglishField(slots.BARE || "");
        if (k === "VED") return normalizeEnglishField(slots.VED || "");
        if (k === "OC") return normalizeEnglishField(slots.OC || "");
        if (k === "IO") return normalizeEnglishField(slots.IO || "");
        if (k === "DO") return normalizeEnglishField(slots.DO || "");
        return sanitizeLooseText(slots[k] || "");
      })
      .filter(Boolean);

    const pp = toPastParticiple(baseV);
    const ving = toIng(baseV);

    const feedback = buildFeedback({
      verb: baseV,
      tense,
      mode,
      S,
      patternId,
      modal,
      collectiveStyle,
      allowSubjunctiveIwere,
      showPerfectTense,
    });

    if (mode === "why_not") {
      return {
        sentencePreviewRaw:
          ["Why not", baseV, ...tailParts].filter(Boolean).join(" ") + "?",
        feedbackList: feedback,
      };
    }

    const useNaturalThatQuestion = shouldUseNaturalThatQuestion({
      verb: baseV,
      patternId,
      mode,
    });

    const modalAux = modal || "";
    const futureAux = ["future", "future_cont"].includes(tense) ? "will" : "";
    const hasAux = Boolean(modalAux || futureAux);

    const progBe = () => {
      if (tense === "future_cont") return "be";
      return beFormForProgressive(
        tense,
        S,
        collectiveStyle,
        allowSubjunctiveIwere
      );
    };

    const vSimple = () => {
      if (tense === "past") {
        return conjVerb(
          baseV,
          "past",
          S,
          collectiveStyle,
          allowSubjunctiveIwere
        );
      }
      return conjVerb(
        baseV,
        "present",
        S,
        collectiveStyle,
        allowSubjunctiveIwere
      );
    };

    const perfectHave = () => haveFormForPerfect(tense, S, collectiveStyle);

    if (mode === "affirm") {
      if (tense === "future_perfect") {
        return {
          sentencePreviewRaw:
            [S, "will", "have", pp, ...tailParts].filter(Boolean).join(" ") +
            ".",
          feedbackList: feedback,
        };
      }

      if (tense === "future_perfect_cont") {
        return {
          sentencePreviewRaw:
            [S, "will", "have", "been", ving, ...tailParts]
              .filter(Boolean)
              .join(" ") + ".",
          feedbackList: feedback,
        };
      }

      if (hasAux) {
        const aux = futureAux || modalAux;

        if (isCont) {
          return {
            sentencePreviewRaw:
              [S, aux, "be", ving, ...tailParts].filter(Boolean).join(" ") +
              ".",
            feedbackList: feedback,
          };
        }

        return {
          sentencePreviewRaw:
            [S, aux, baseV, ...tailParts].filter(Boolean).join(" ") + ".",
          feedbackList: feedback,
        };
      }

      if (isPerfect) {
        return {
          sentencePreviewRaw:
            [S, perfectHave(), pp, ...tailParts].filter(Boolean).join(" ") +
            ".",
          feedbackList: feedback,
        };
      }

      if (isPerfectCont) {
        return {
          sentencePreviewRaw:
            [S, perfectHave(), "been", ving, ...tailParts]
              .filter(Boolean)
              .join(" ") + ".",
          feedbackList: feedback,
        };
      }

      if (isCont) {
        return {
          sentencePreviewRaw:
            [S, progBe(), ving, ...tailParts].filter(Boolean).join(" ") + ".",
          feedbackList: feedback,
        };
      }

      return {
        sentencePreviewRaw:
          [S, vSimple(), ...tailParts].filter(Boolean).join(" ") + ".",
        feedbackList: feedback,
      };
    }

    if (mode === "negative") {
      if (tense === "future_perfect") {
        const [a, b] = contractNot("will", useContraction);
        return {
          sentencePreviewRaw:
            [S, a, b, "have", pp, ...tailParts].filter(Boolean).join(" ") + ".",
          feedbackList: feedback,
        };
      }

      if (tense === "future_perfect_cont") {
        const [a, b] = contractNot("will", useContraction);
        return {
          sentencePreviewRaw:
            [S, a, b, "have", "been", ving, ...tailParts]
              .filter(Boolean)
              .join(" ") + ".",
          feedbackList: feedback,
        };
      }

      if (hasAux) {
        const [a, b] = contractNot(futureAux || modalAux, useContraction);

        if (isCont) {
          return {
            sentencePreviewRaw:
              [S, a, b, "be", ving, ...tailParts].filter(Boolean).join(" ") +
              ".",
            feedbackList: feedback,
          };
        }

        return {
          sentencePreviewRaw:
            [S, a, b, baseV, ...tailParts].filter(Boolean).join(" ") + ".",
          feedbackList: feedback,
        };
      }

      if (isPerfect) {
        const [a, b] = contractNot(perfectHave(), useContraction);
        return {
          sentencePreviewRaw:
            [S, a, b, pp, ...tailParts].filter(Boolean).join(" ") + ".",
          feedbackList: feedback,
        };
      }

      if (isPerfectCont) {
        const [a, b] = contractNot(perfectHave(), useContraction);
        return {
          sentencePreviewRaw:
            [S, a, b, "been", ving, ...tailParts].filter(Boolean).join(" ") +
            ".",
          feedbackList: feedback,
        };
      }

      if (isCont) {
        const [a, b] = contractNot(progBe(), useContraction);
        return {
          sentencePreviewRaw:
            [S, a, b, ving, ...tailParts].filter(Boolean).join(" ") + ".",
          feedbackList: feedback,
        };
      }

      if (baseV === "be") {
        const be = conjVerb(
          "be",
          tense === "past" ? "past" : "present",
          S,
          collectiveStyle,
          allowSubjunctiveIwere
        );
        const [a, b] = contractNot(be, useContraction);
        return {
          sentencePreviewRaw:
            [S, a, b, ...tailParts].filter(Boolean).join(" ") + ".",
          feedbackList: feedback,
        };
      }

      const auxBase =
        tense === "past"
          ? "did"
          : getStrictDoAux(S, tense, collectiveStyle).toLowerCase();
      const [a, b] = contractNot(auxBase, useContraction);

      return {
        sentencePreviewRaw:
          [S, a, b, baseV, ...tailParts].filter(Boolean).join(" ") + ".",
        feedbackList: feedback,
      };
    }

    if (isWhSubject(S) && mode === "question") {
      if (tense === "future_perfect") {
        return {
          sentencePreviewRaw:
            [S, "will", "have", pp, ...tailParts].filter(Boolean).join(" ") +
            "?",
          feedbackList: feedback,
        };
      }

      if (tense === "future_perfect_cont") {
        return {
          sentencePreviewRaw:
            [S, "will", "have", "been", ving, ...tailParts]
              .filter(Boolean)
              .join(" ") + "?",
          feedbackList: feedback,
        };
      }

      if (hasAux && !useNaturalThatQuestion) {
        const aux = futureAux || modalAux;
        if (isCont) {
          return {
            sentencePreviewRaw:
              [S, aux, "be", ving, ...tailParts].filter(Boolean).join(" ") +
              "?",
            feedbackList: feedback,
          };
        }
        return {
          sentencePreviewRaw:
            [S, aux, baseV, ...tailParts].filter(Boolean).join(" ") + "?",
          feedbackList: feedback,
        };
      }

      if (isPerfect) {
        return {
          sentencePreviewRaw:
            [S, perfectHave(), pp, ...tailParts].filter(Boolean).join(" ") +
            "?",
          feedbackList: feedback,
        };
      }

      if (isPerfectCont) {
        return {
          sentencePreviewRaw:
            [S, perfectHave(), "been", ving, ...tailParts]
              .filter(Boolean)
              .join(" ") + "?",
          feedbackList: feedback,
        };
      }

      if (isCont) {
        return {
          sentencePreviewRaw:
            [S, progBe(), ving, ...tailParts].filter(Boolean).join(" ") + "?",
          feedbackList: feedback,
        };
      }

      return {
        sentencePreviewRaw:
          [S, vSimple(), ...tailParts].filter(Boolean).join(" ") + "?",
        feedbackList: feedback,
      };
    }

    let whFront = "";
    if (isWhAdverb(MOD_raw)) {
      if (
        firstWordLower(MOD_raw) === "how" &&
        baseV === "be" &&
        patternId === "SVC_BE_ID" &&
        SC_raw &&
        !scLooksLikeNoun(SC_raw)
      ) {
        whFront = `how ${SC_raw}`;
        tailParts = tailParts.filter(
          (x) =>
            x.toLowerCase() !== SC_raw.toLowerCase() &&
            x.toLowerCase() !== MOD_raw.toLowerCase()
        );
      } else {
        whFront = MOD_raw;
        tailParts = tailParts.filter(
          (x) => x.toLowerCase() !== MOD_raw.toLowerCase()
        );
      }
    }

    if (!whFront && isWhSubject(O_raw)) {
      whFront = O_raw;
      tailParts = tailParts.filter(
        (x) => x.toLowerCase() !== O_raw.toLowerCase()
      );
    }

    if (!whFront && TO_V_raw) {
      const ex = extractTrailingWhFromToV(TO_V_raw);
      if (ex?.wh) {
        whFront = ex.wh;
        tailParts = tailParts.map((p) =>
          p.toLowerCase() === TO_V_raw.toLowerCase() ? ex.rest : p
        );
      }
    }

    if (useNaturalThatQuestion) {
      const aux = getStrictDoAux(S, tense, collectiveStyle);

      if (mode === "neg_question") {
        const negAux =
          aux === "Did" ? "Didn't" : aux === "Does" ? "Doesn't" : "Don't";
        return {
          sentencePreviewRaw:
            [whFront, negAux, S, baseV, ...tailParts]
              .filter(Boolean)
              .join(" ") + "?",
          feedbackList: feedback,
        };
      }

      return {
        sentencePreviewRaw:
          [whFront, aux, S, baseV, ...tailParts].filter(Boolean).join(" ") +
          "?",
        feedbackList: feedback,
      };
    }

    if (tense === "future_perfect") {
      const front = mode === "neg_question" ? "Won't" : "Will";
      return {
        sentencePreviewRaw:
          [whFront, front, S, "have", pp, ...tailParts]
            .filter(Boolean)
            .join(" ") + "?",
        feedbackList: feedback,
      };
    }

    if (tense === "future_perfect_cont") {
      const front = mode === "neg_question" ? "Won't" : "Will";
      return {
        sentencePreviewRaw:
          [whFront, front, S, "have", "been", ving, ...tailParts]
            .filter(Boolean)
            .join(" ") + "?",
        feedbackList: feedback,
      };
    }

    if (hasAux) {
      const aux = futureAux || modalAux;
      const AuxCap = aux[0].toUpperCase() + aux.slice(1);

      if (mode === "neg_question") {
        const neg = aux.toLowerCase() === "will" ? "Won't" : `${AuxCap} not`;
        if (isCont) {
          return {
            sentencePreviewRaw:
              [whFront, neg, S, "be", ving, ...tailParts]
                .filter(Boolean)
                .join(" ") + "?",
            feedbackList: feedback,
          };
        }
        return {
          sentencePreviewRaw:
            [whFront, neg, S, baseV, ...tailParts].filter(Boolean).join(" ") +
            "?",
          feedbackList: feedback,
        };
      }

      if (isCont) {
        return {
          sentencePreviewRaw:
            [whFront, AuxCap, S, "be", ving, ...tailParts]
              .filter(Boolean)
              .join(" ") + "?",
          feedbackList: feedback,
        };
      }

      return {
        sentencePreviewRaw:
          [whFront, AuxCap, S, baseV, ...tailParts].filter(Boolean).join(" ") +
          "?",
        feedbackList: feedback,
      };
    }

    if (isPerfect) {
      const hv = perfectHave();
      const HvCap = hv[0].toUpperCase() + hv.slice(1);
      const neg = hv === "has" ? "Hasn't" : hv === "had" ? "Hadn't" : "Haven't";
      return {
        sentencePreviewRaw:
          [whFront, mode === "neg_question" ? neg : HvCap, S, pp, ...tailParts]
            .filter(Boolean)
            .join(" ") + "?",
        feedbackList: feedback,
      };
    }

    if (isPerfectCont) {
      const hv = perfectHave();
      const HvCap = hv[0].toUpperCase() + hv.slice(1);
      const neg = hv === "has" ? "Hasn't" : hv === "had" ? "Hadn't" : "Haven't";
      return {
        sentencePreviewRaw:
          [
            whFront,
            mode === "neg_question" ? neg : HvCap,
            S,
            "been",
            ving,
            ...tailParts,
          ]
            .filter(Boolean)
            .join(" ") + "?",
        feedbackList: feedback,
      };
    }

    if (isCont) {
      const be = progBe();
      const BeCap = be[0].toUpperCase() + be.slice(1);
      const neg =
        be === "is"
          ? "Isn't"
          : be === "are"
          ? "Aren't"
          : be === "was"
          ? "Wasn't"
          : "Weren't";
      return {
        sentencePreviewRaw:
          [
            whFront,
            mode === "neg_question" ? neg : BeCap,
            S,
            ving,
            ...tailParts,
          ]
            .filter(Boolean)
            .join(" ") + "?",
        feedbackList: feedback,
      };
    }

    if (baseV === "be") {
      const be = conjVerb(
        "be",
        tense === "past" ? "past" : "present",
        S,
        collectiveStyle,
        allowSubjunctiveIwere
      );
      const BeCap = be[0].toUpperCase() + be.slice(1);
      const neg =
        be === "is"
          ? "Isn't"
          : be === "are"
          ? "Aren't"
          : be === "was"
          ? "Wasn't"
          : "Weren't";
      return {
        sentencePreviewRaw:
          [whFront, mode === "neg_question" ? neg : BeCap, S, ...tailParts]
            .filter(Boolean)
            .join(" ") + "?",
        feedbackList: feedback,
      };
    }

    const aux = getStrictDoAux(S, tense, collectiveStyle);
    const negAux =
      aux === "Did" ? "Didn't" : aux === "Does" ? "Doesn't" : "Don't";
    return {
      sentencePreviewRaw:
        [
          whFront,
          mode === "neg_question" ? negAux : aux,
          S,
          baseV,
          ...tailParts,
        ]
          .filter(Boolean)
          .join(" ") + "?",
      feedbackList: feedback,
    };
  }, [
    patternId,
    slots,
    verb,
    tense,
    mode,
    modal,
    collectiveStyle,
    allowSubjunctiveIwere,
    useContraction,
    showPerfectTense,
  ]);

  const sentencePreview = useMemo(
    () => normalizeSentenceCase(sentencePreviewRaw, PROPER_NOUNS),
    [sentencePreviewRaw]
  );
  const feedbackText = useMemo(
    () => (feedbackList || []).join("\n"),
    [feedbackList]
  );
  const hasFeedback = feedbackList?.length > 0;

  const visibleSaved = useMemo(() => {
    const fc = filterClassNo.trim().toLowerCase();
    const fn = filterStudentNo.trim().toLowerCase();
    let list = saved;
    if (fc)
      list = list.filter((r) => (r.classNo || "").toLowerCase().includes(fc));
    if (fn)
      list = list.filter((r) => (r.studentNo || "").toLowerCase().includes(fn));

    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...list].sort((a, b) => {
      if (sortKey === "time") return dir * ((a.ts || 0) - (b.ts || 0));
      const av = String(a[sortKey] ?? "");
      const bv = String(b[sortKey] ?? "");
      return dir * av.localeCompare(bv, "ko");
    });

    return sortKey === "time" && sortDir === "desc" ? sorted.reverse() : sorted;
  }, [saved, filterClassNo, filterStudentNo, sortKey, sortDir]);

  const onCheckSave = useCallback(() => {
    const cleanName = normalizeStudentName(studentName);

    if (!classNo.trim() || !studentNo.trim() || !cleanName) {
      setMessage("⚠️ 반 / 번호 / 이름을 모두 입력해 주세요.");
      return;
    }
    if (!patternId) {
      setMessage("⚠️ 문장형식을 먼저 선택해 주세요.");
      return;
    }

    const pat = PATTERNS[patternId];
    const requiredKeys =
      mode === "why_not" ? pat.required.filter((k) => k !== "S") : pat.required;

    for (const k of requiredKeys) {
      const val =
        k === "THAT"
          ? sanitizeKeepSpaces(slots[k] || "")
          : sanitizeLooseText(slots[k] || "");
      if (!val.trim()) {
        setMessage(`⚠️ ${SLOT_LABEL[k] || k} 칸을 채워 주세요.`);
        return;
      }
    }

    const shapeMsg = validateShape(patternId, slots);
    if (shapeMsg) {
      setMessage(`⚠️ ${shapeMsg}`);
      return;
    }

    if (!sentencePreview.trim()) {
      setMessage("⚠️ 문장이 아직 완성되지 않았어요.");
      return;
    }

    const tenseLabelMap = Object.fromEntries(
      [...TENSE_OPTIONS_BASE, ...TENSE_OPTIONS_PERFECT].map((t) => [
        t.key,
        t.label,
      ])
    );
    const modeLabelMap = {
      affirm: "평서",
      negative: "부정",
      question: "의문",
      neg_question: "의문부정",
      why_not: "Why not",
    };

    const noteBase =
      verb === "make"
        ? explainMakeMeaning(patternId) || verbMeta?.patterns?.[patternId] || ""
        : verbMeta?.patterns?.[patternId] || "";

    const note = `${noteBase}${modal ? ` / modal:${modal}` : ""}${
      tense ? ` / ${tenseLabelMap[tense] || tense}` : ""
    }${mode ? ` / ${modeLabelMap[mode] || mode}` : ""}`;

    const ts = Date.now();
    const timeStr = new Date(ts).toLocaleString();

    setSaved((prev) => [
      ...prev,
      {
        classNo: classNo.trim(),
        studentNo: studentNo.trim(),
        name: cleanName,
        sentence: sentencePreview.trim(),
        verb,
        patternId,
        patternName: PATTERNS[patternId]?.name || patternId,
        tense,
        mode,
        modal,
        note,
        feedbackTag: hasFeedback ? "⚠️ 피드백 포함" : "",
        feedbackDetail: hasFeedback ? feedbackText : "",
        ts,
        timeStr,
      },
    ]);

    setMessage(
      hasFeedback
        ? "✅ 저장 완료! 피드백도 함께 저장되었어요."
        : "✅ 저장 완료!"
    );
  }, [
    classNo,
    studentNo,
    studentName,
    patternId,
    mode,
    slots,
    sentencePreview,
    verb,
    verbMeta,
    modal,
    tense,
    hasFeedback,
    feedbackText,
  ]);

  const clearCurrentInputs = useCallback(() => {
    setSlots((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (k !== "V") next[k] = "";
      });
      return next;
    });
    setMessage("입력 칸을 비웠어요.");
  }, []);

  const deleteSavedItem = useCallback((ts) => {
    setSaved((prev) => prev.filter((x) => x.ts !== ts));
  }, []);

  return (
    <div style={shell}>
      <div style={wrap}>
        <section style={card}>
          <h1 style={title}>영어 문장 패턴 연습 앱</h1>
          <div style={sub}>
            배포용 최종본 · 완료시제 토글 · THAT 공백 보존 · 저장/CSV 지원
          </div>
        </section>

        <section style={card}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800 }}>학생 정보</div>
            <span style={badge}>상단 입력칸 개선 완료</span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              marginTop: 14,
            }}
          >
            <div>
              <div style={label}>학년/반</div>
              <input
                style={input}
                value={classNo}
                onChange={(e) => setClassNo(e.target.value)}
                placeholder="예: 3-3"
              />
            </div>
            <div>
              <div style={label}>번호</div>
              <input
                style={input}
                value={studentNo}
                onChange={(e) => setStudentNo(e.target.value)}
                placeholder="예: 15"
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={label}>이름</div>
            <input
              style={{ ...input, fontSize: 16, padding: "14px 16px" }}
              value={studentName}
              onChange={(e) =>
                setStudentName(preserveTypingText(e.target.value))
              }
              onBlur={() =>
                setStudentName((prev) => normalizeStudentName(prev))
              }
              placeholder="이름을 입력하세요 (필수)"
            />
          </div>
        </section>

        <section style={card}>
          <button
            style={{ ...btn, width: "100%", justifyContent: "center" }}
            onClick={() => setTeacherModeOpen((v) => !v)}
          >
            {teacherModeOpen ? "교사용 설정 닫기" : "교사용 설정 열기"}
          </button>

          {teacherModeOpen && (
            <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
              <div>
                <div style={label}>학년 필터</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(LEVEL_LABEL).map(([key, text]) => (
                    <button
                      key={key}
                      style={pill(levelFilter === key)}
                      onClick={() => setLevelFilter(key)}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                }}
              >
                <label
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <input
                    type="checkbox"
                    checked={showPerfectTense}
                    onChange={(e) => setShowPerfectTense(e.target.checked)}
                  />
                  완료/완료진행 시제 보이기
                </label>

                <label
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <input
                    type="checkbox"
                    checked={useContraction}
                    onChange={(e) => setUseContraction(e.target.checked)}
                  />
                  축약형 사용
                </label>

                <label
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <input
                    type="checkbox"
                    checked={allowSubjunctiveIwere}
                    onChange={(e) => setAllowSubjunctiveIwere(e.target.checked)}
                  />
                  가정법 I were 허용
                </label>

                <div>
                  <div style={label}>집합명사 스타일</div>
                  <select
                    style={select}
                    value={collectiveStyle}
                    onChange={(e) => setCollectiveStyle(e.target.value)}
                  >
                    <option value="US">US</option>
                    <option value="UK">UK</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </section>

        <section style={card}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <div style={label}>동사 선택</div>
              <select
                style={select}
                value={verb}
                onChange={(e) => onChangeVerb(e.target.value)}
              >
                {verbsFiltered.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.key}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={label}>시제</div>
              <select
                style={select}
                value={tense}
                onChange={(e) => setTense(e.target.value)}
              >
                {visibleTenseOptions.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={label}>문장유형</div>
              <select
                style={select}
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                {MODE_OPTIONS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={label}>조동사</div>
              <select
                style={select}
                value={modal}
                onChange={(e) => setModal(e.target.value)}
              >
                {MODALS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={label}>문장형식 선택</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {allowedPatternIds.map((pid) => (
                <button
                  key={pid}
                  style={pill(patternId === pid)}
                  onClick={() => onPickPattern(pid)}
                >
                  {PATTERNS[pid]?.name || pid}
                </button>
              ))}
            </div>
          </div>

          {meaningCard && (
            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 14,
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
              }}
            >
              <div style={{ fontWeight: 800 }}>{meaningCard.patternName}</div>
              <div style={{ marginTop: 6, fontSize: 14 }}>
                의미: {meaningCard.meaning || "-"}
              </div>
              <div style={{ marginTop: 4, fontSize: 14, color: "#4b5563" }}>
                힌트: {meaningCard.hint || "-"}
              </div>
              {meaningCard.extra ? (
                <div style={{ marginTop: 6, fontSize: 13, color: "#92400e" }}>
                  {meaningCard.extra}
                </div>
              ) : null}
            </div>
          )}
        </section>

        {patternId && (
          <section style={card}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>
              입력 칸
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              {PATTERNS[patternId].slots
                .filter((slotKey) => slotKey !== "V")
                .map((slotKey) => {
                  const placeholderMap = {
                    S: disableSubject
                      ? "Why not 문형에서는 자동 생략"
                      : "예: I / she / my team",
                    O: "예: the classroom",
                    IO: "예: me / my friend",
                    DO: "예: a book",
                    SC: "예: smart / a teacher",
                    OC: "예: happy / red",
                    TO_V: "예: to study",
                    VING: "예: studying",
                    BARE: "예: study",
                    VED: "예: cleaned / broken",
                    THAT: "예: that I should clean the classroom",
                    IF_WHETHER:
                      "예: whether he is coming / if she likes English",
                    WH_CLAUSE: "예: where I should go / what he wants",
                    MOD: "예: at school / every day / when I am tired",
                  };

                  return (
                    <div
                      key={slotKey}
                      style={
                        slotKey === "THAT"
                          ? { gridColumn: "1 / -1" }
                          : undefined
                      }
                    >
                      <div style={label}>{SLOT_LABEL[slotKey]}</div>
                      <input
                        style={{
                          ...input,
                          minHeight: slotKey === "THAT" ? 48 : undefined,
                          fontSize: slotKey === "THAT" ? 16 : 15,
                          background:
                            disableSubject && slotKey === "S"
                              ? "#f3f4f6"
                              : "white",
                        }}
                        value={slots[slotKey] || ""}
                        onChange={(e) => onChangeSlot(slotKey, e.target.value)}
                        placeholder={placeholderMap[slotKey] || "입력"}
                        disabled={disableSubject && slotKey === "S"}
                      />
                    </div>
                  );
                })}
            </div>

            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 14,
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>
                문장 미리보기
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.6 }}>
                {sentencePreview || "문장을 만들면 여기 보입니다."}
              </div>
            </div>

            {hasFeedback && (
              <div
                style={{
                  marginTop: 12,
                  padding: 14,
                  borderRadius: 14,
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  whiteSpace: "pre-wrap",
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              >
                {feedbackText}
              </div>
            )}

            {message && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 12,
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  fontWeight: 700,
                }}
              >
                {message}
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 16,
              }}
            >
              <button style={primaryBtn} onClick={onCheckSave}>
                CHECK & SAVE
              </button>
              <button style={btn} onClick={clearCurrentInputs}>
                입력칸 비우기
              </button>
            </div>
          </section>
        )}

        <section style={card}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800 }}>저장 목록</div>
            <button style={btn} onClick={() => downloadCSV(saved)}>
              CSV 다운로드
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginTop: 14,
            }}
          >
            <div>
              <div style={label}>반 필터</div>
              <input
                style={input}
                value={filterClassNo}
                onChange={(e) => setFilterClassNo(e.target.value)}
                placeholder="예: 3-3"
              />
            </div>
            <div>
              <div style={label}>번호 필터</div>
              <input
                style={input}
                value={filterStudentNo}
                onChange={(e) => setFilterStudentNo(e.target.value)}
                placeholder="예: 15"
              />
            </div>
            <div>
              <div style={label}>정렬 기준</div>
              <select
                style={select}
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
              >
                <option value="time">저장시간</option>
                <option value="classNo">반</option>
                <option value="studentNo">번호</option>
                <option value="name">이름</option>
              </select>
            </div>
            <div>
              <div style={label}>정렬 방향</div>
              <select
                style={select}
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value)}
              >
                <option value="desc">내림차순</option>
                <option value="asc">오름차순</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {visibleSaved.length === 0 ? (
              <div
                style={{
                  padding: 14,
                  border: "1px dashed #d1d5db",
                  borderRadius: 12,
                  color: "#6b7280",
                }}
              >
                저장된 문장이 없습니다.
              </div>
            ) : (
              visibleSaved.map((row) => (
                <div
                  key={row.ts}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 14,
                    background: "#fcfcfd",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span style={badge}>{row.classNo}</span>
                      <span style={badge}>{row.studentNo}번</span>
                      <span style={badge}>{row.name}</span>
                    </div>
                    <button style={btn} onClick={() => deleteSavedItem(row.ts)}>
                      삭제
                    </button>
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 18,
                      fontWeight: 800,
                      lineHeight: 1.6,
                    }}
                  >
                    {row.sentence}
                  </div>

                  <div style={{ marginTop: 8, fontSize: 13, color: "#4b5563" }}>
                    {row.patternName} / {row.tense} / {row.mode}
                    {row.modal ? ` / ${row.modal}` : ""}
                  </div>

                  {row.note ? (
                    <div
                      style={{ marginTop: 6, fontSize: 13, color: "#6b7280" }}
                    >
                      {row.note}
                    </div>
                  ) : null}

                  {row.feedbackDetail ? (
                    <div
                      style={{
                        marginTop: 8,
                        whiteSpace: "pre-wrap",
                        fontSize: 13,
                        color: "#92400e",
                        background: "#fffbeb",
                        border: "1px solid #fde68a",
                        borderRadius: 10,
                        padding: 10,
                      }}
                    >
                      {row.feedbackDetail}
                    </div>
                  ) : null}

                  <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
                    {row.timeStr}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
