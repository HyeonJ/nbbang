/**
 * CSV 직렬화 (F7) — 순수 함수. DB도 Request도 모르며, 아는 것은 **문법과 스프레드시트**다.
 *
 * ── 이 모듈이 막는 것: 수식 주입 ─────────────────────────────────────────────
 * `= + - @`, 탭, CR로 시작하는 셀은 Excel·Google Sheets·LibreOffice가 **수식으로 평가**한다.
 * 메모에 `=cmd|' /C calc'!A0`를 적어 놓고 CSV를 총무에게 보내면, 총무가 파일을 여는 순간
 * 그 사람의 컴퓨터에서 실행을 시도한다(임포터에 따라 경고가 붙지만, 경고를 누르는 사람은 있다).
 *
 * **인용은 방어가 아니다.** `"=cmd"`도 그대로 평가된다 — 임포터는 인용을 먼저 벗기고 값을 본다.
 * 인용은 *파싱*(어디까지가 한 셀인가)을 위한 것이고, 방어는 **접두사**다.
 *
 * ── 접두사를 `'`로 고른 이유 ─────────────────────────────────────────────────
 * 후보는 홑따옴표(`'`)와 선행 탭/공백이었다. `'`를 택한다:
 *  1. OWASP가 문서화한 방어이며 Excel·Sheets·LibreOffice 모두에서 "뒤는 텍스트"로 동작한다,
 *  2. 공백·탭은 **공백이라 잘린다** — 임포터의 트리밍 옵션(Excel의 "공백 제거", 다른 도구의
 *     기본 트리밍) 하나만 켜지면 방어가 사라지고 수식이 되살아난다. 방어가 임포터 설정에
 *     의존하면 방어가 아니다,
 *  3. 눈에 보인다 — 셀에 `'=1+1`이 보이면 사람이 "이 값은 무장 해제됐다"를 알 수 있다.
 *     투명성이 이 제품의 주제이므로, 조용히 값을 바꾸는 쪽보다 보이는 쪽이 낫다.
 *
 * ── 그런데 음수는 `-`로 시작한다 ────────────────────────────────────────────
 * 전부 접두사를 붙이면 `-15000`이 `'-15000`이 되어 **모든 음수가 텍스트로 망가진다**. 그래서
 * 이 직렬화기는 열 타입을 받는다(`CsvColumn.type`). 값을 보고 추측하지 않는다 — "숫자로
 * 파싱되면 그대로"는 틀렸다: 메모에 `-cmd`가 들어오면 그건 텍스트이므로 방어해야 하는데
 * 파싱 규칙으로는 `-15000`과 구별할 근거가 없다. 구별하는 것은 **그 열이 무엇인가**다.
 *
 * 열 타입은 선언이지 보증이 아니므로 number 레인은 값을 **확인**한다 — 정수·소수 형태가
 * 아니면 text 레인으로 떨어뜨린다. 그래서 number 열은 우회 경로가 되지 않는다.
 */

export type CsvColumn = {
  /** 행 객체에서 값을 꺼낼 키. */
  key: string;
  /** 첫 줄에 나갈 사람이 읽는 이름. */
  header: string;
  /**
   * `number` — 값을 그대로 내보낸다(접두사·인용 없음). 스프레드시트가 숫자로 읽어야 하는 열.
   * `text`   — 수식 주입 방어 접두사 + RFC4180 인용.
   */
  type: 'text' | 'number';
};

export type CsvRow = Record<string, unknown>;

/**
 * UTF-8 BOM. Windows Excel은 BOM이 없는 UTF-8 CSV를 **cp949로 읽어** 한글을 깨뜨린다
 * (모지바케 — 이 기능에서 가장 흔히 터지는 실패). 파일로 내보낼 때는 반드시 앞에 붙인다.
 */
export const CSV_BOM = '\uFEFF';

/** 첫 글자가 이것들이면 스프레드시트가 셀을 수식으로 본다. */
const DANGEROUS_FIRST = new Set(['=', '+', '-', '@', '\t', '\r', '\n']);

/** RFC4180 — 이 문자가 들어 있으면 셀을 인용해야 파싱이 어긋나지 않는다. */
const NEEDS_QUOTE = /[",\r\n]/;

/** 앞뒤 공백·탭. 인용하지 않으면 임포터가 잘라내 값이 달라진다. */
const EDGE_SPACE = /^[ \t]|[ \t]$/;

/** 표시용 마이너스(U+2212, `−`). 스프레드시트는 이것을 숫자로 읽지 못한다. */
const MINUS_SIGN = '\u2212';

/** 정수·소수만. `+1`·`1e3`·`0x10`·`1,000`은 통과하지 못하고 text 레인으로 간다. */
const PLAIN_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function quote(value: string): string {
  return `"${value.split('"').join('""')}"`;
}

/**
 * text 셀 — 방어 → 인용 순서. 순서가 바뀌면 접두사가 인용 **밖**에 붙어 셀 하나가 밀린다.
 *
 * 탐지는 선행 공백을 무시하지만 **값은 보존한다**(공백을 지우지 않는다). `'  =1+1'`처럼
 * 공백으로 감춘 수식도 방어하면서, 데이터를 조용히 고치지 않기 위한 선택이다.
 */
function textCell(raw: unknown): string {
  const value = raw === null || raw === undefined ? '' : String(raw);
  const firstMeaningful = value.replace(/^ +/, '').charAt(0);
  const defused = firstMeaningful !== '' && DANGEROUS_FIRST.has(firstMeaningful);
  const text = defused ? `'${value}` : value;
  // 무장 해제한 셀은 **항상** 인용한다: 접두사가 임포터에게 필드의 첫 바이트로 보이는 것이
  // 방어의 전제이고, 인용하지 않으면 트리밍·필드 재분할이 그 전제를 흔들 수 있다.
  return defused || NEEDS_QUOTE.test(text) || EDGE_SPACE.test(text) ? quote(text) : text;
}

/**
 * number 셀 — 스프레드시트가 숫자로 읽어야 하므로 접두사도 인용도 붙이지 않는다.
 * 음수는 **ASCII 하이픈**이다(U+2212로 들어오면 되돌린다).
 *
 * 값이 숫자 형태가 아니면 `textCell`로 넘긴다 — 열 타입을 믿고 무방비로 내보내지 않는다.
 */
function numberCell(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(raw) : textCell(raw);
  }
  const normalized = String(raw).split(MINUS_SIGN).join('-').trim();
  if (normalized === '') return '';
  return PLAIN_NUMBER.test(normalized) ? normalized : textCell(raw);
}

/**
 * 열 정의와 행 객체로 CSV 본문을 만든다. **BOM은 붙이지 않는다**(문법과 인코딩을 섞지 않는다) —
 * 파일로 내보낼 때는 `toCsvFile`을 쓴다.
 *
 * 행은 배열이 아니라 객체다: 열 정의와 행이 위치로 맞물리면 열을 하나 끼워 넣는 순간
 * 모든 값이 한 칸씩 밀리고 **테스트는 초록으로 남는다**(둘 다 문자열이므로). 키로 맞추면
 * 그 실수가 빈 열로 즉시 드러난다. 끝에 개행을 붙이지 않아 마지막 빈 행이 생기지 않는다.
 */
export function toCsv(columns: readonly CsvColumn[], rows: readonly CsvRow[]): string {
  if (columns.length === 0) throw new Error('toCsv: 열이 하나도 없다');
  const lines = [columns.map((c) => textCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => (c.type === 'number' ? numberCell(row[c.key]) : textCell(row[c.key])))
        .join(','),
    );
  }
  return lines.join('\r\n');
}

/**
 * 다운로드 본문 — `toCsv` + BOM.
 *
 * 별도 함수로 두는 이유: BOM을 붙이는 일을 **라우트의 기억**에 맡기면 언젠가 빠진다.
 * 라우트가 부르는 이름 자체가 "파일"이면 빠뜨릴 자리가 없다.
 */
export function toCsvFile(columns: readonly CsvColumn[], rows: readonly CsvRow[]): string {
  return `${CSV_BOM}${toCsv(columns, rows)}`;
}

/** 경로 구분자와 Windows 예약 문자 — 흔적 없이 지운다. */
const RESERVED_FILENAME = /[\\/:*?"<>|]/g;

/** 제어 문자(CR·LF·탭 포함). 헤더 주입의 재료이므로 공백으로 바꾼 뒤 접는다. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * 사용자 입력(모임 이름)을 파일명 조각으로 정리한다. 남는 게 없으면 빈 문자열 —
 * 호출자가 이름 없는 폴백 파일명을 쓰도록.
 */
export function safeFilenamePart(raw: string, maxLength = 40): string {
  return raw
    .replace(RESERVED_FILENAME, '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** RFC 5987 — `encodeURIComponent`가 남기는 `!'()*`까지 퍼센트 인코딩한다. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()!*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * `Content-Disposition: attachment` 헤더 값.
 *
 * 모임 이름은 **사용자 입력**이라 그대로 헤더에 넣을 수 없다 — 따옴표로 인용을 탈출하거나
 * CRLF로 헤더를 하나 더 만들 수 있다. 그래서 두 가지를 한다:
 *  1. 한글 이름은 `filename*=UTF-8''<퍼센트 인코딩>`으로 싣는다(헤더 값은 ASCII만 허용된다),
 *  2. `filename=`에는 **호출자가 만든 ASCII 폴백**만 넣고, 혹시 모를 문자는 걷어낸다.
 * 결과 문자열은 전부 인쇄 가능한 ASCII다.
 */
export function attachmentDisposition(filename: string, asciiFallback: string): string {
  const safeName = safeFilenamePart(filename, 120);
  const safeFallback = safeFilenamePart(asciiFallback, 120).replace(/[^ -~]/g, '');
  return `attachment; filename="${safeFallback}"; filename*=UTF-8''${encodeRfc5987(safeName)}`;
}
