import { describe, expect, it } from 'vitest';
import {
  attachmentDisposition,
  CSV_BOM,
  safeFilenamePart,
  toCsv,
  toCsvFile,
  type CsvColumn,
} from '@/lib/csv';

/**
 * CSV의 진짜 위험은 **이스케이프**다 — 그중에서도 스프레드시트 수식 주입.
 *
 * 이 파일이 고정하는 불변식 네 갈래:
 *  1. RFC4180 문법(인용·따옴표 이중화·CRLF),
 *  2. text 열의 수식 주입 방어(접두사 `'`),
 *  3. number 열은 접두사를 **붙이지 않는다**(음수 `-15000`이 숫자로 읽혀야 한다) —
 *     그러면서도 number 열이 우회 경로가 되지 않는다,
 *  4. UTF-8 BOM(Excel on Windows의 한글).
 *
 * 값은 "아플 값"으로 고른다. `abc`로 초록이 되는 테스트는 아무것도 증명하지 않는다.
 */

const T = (key: string, header = key): CsvColumn => ({ key, header, type: 'text' });
const N = (key: string, header = key): CsvColumn => ({ key, header, type: 'number' });

describe('toCsv — RFC4180 문법', () => {
  it('헤더와 행을 CRLF로 잇고 끝에 개행을 붙이지 않는다', () => {
    expect(toCsv([T('a'), T('b')], [{ a: '1', b: '2' }])).toBe('a,b\r\n1,2');
  });

  it('행이 없으면 헤더 한 줄뿐이다', () => {
    expect(toCsv([T('a'), T('b')], [])).toBe('a,b');
  });

  it('쉼표·따옴표·개행이 든 값을 인용한다', () => {
    expect(toCsv([T('x')], [{ x: 'a,b' }])).toBe('x\r\n"a,b"');
    expect(toCsv([T('x')], [{ x: '그는 "네"라고' }])).toBe('x\r\n"그는 ""네""라고"');
    expect(toCsv([T('x')], [{ x: '첫줄\n둘째줄' }])).toBe('x\r\n"첫줄\n둘째줄"');
    expect(toCsv([T('x')], [{ x: '첫줄\r\n둘째줄' }])).toBe('x\r\n"첫줄\r\n둘째줄"');
  });

  it('한글 메모의 쉼표·따옴표가 함께 있어도 한 셀로 남는다', () => {
    // 실제 메모에서 가장 흔한 조합 — 이 한 줄이 깨지면 열이 밀려 파일 전체가 쓸모없어진다.
    expect(toCsv([T('memo', '메모')], [{ memo: '콤마,와 "따옴표"' }])).toBe(
      '메모\r\n"콤마,와 ""따옴표"""',
    );
  });

  it('빈 문자열·null·undefined·없는 키는 모두 빈 셀이다', () => {
    expect(toCsv([T('a'), T('b'), T('c'), T('d')], [{ a: '', b: null, c: undefined }])).toBe(
      'a,b,c,d\r\n,,,',
    );
  });

  it('앞뒤 공백은 인용으로 보존한다 — 인용하지 않으면 임포터가 잘라낸다', () => {
    expect(toCsv([T('x')], [{ x: '가 나 ' }])).toBe('x\r\n"가 나 "');
    expect(toCsv([T('x')], [{ x: '가나' }])).toBe('x\r\n가나');
  });

  it('헤더도 같은 규칙을 지난다 — 쉼표 든 헤더가 열을 밀지 않는다', () => {
    expect(toCsv([T('x', '금액, 원')], [])).toBe('"금액, 원"');
  });

  it('열이 없으면 던진다 — 열 없는 CSV는 조용히 빈 파일이 되어선 안 된다', () => {
    expect(() => toCsv([], [{ a: '1' }])).toThrow(/열/);
  });
});

describe('toCsv — text 열의 수식 주입 방어', () => {
  /**
   * `= + - @ \t \r \n`으로 시작하는 값은 Excel/Sheets에서 **실행된다**.
   * 인용은 방어가 아니다 — 임포터는 인용을 벗긴 뒤 평가한다. 방어는 접두사 `'`다.
   */
  const hostile = [
    ['=SUM(A1)', `"'=SUM(A1)"`],
    ['=cmd|\' /C calc\'!A0', `"'=cmd|' /C calc'!A0"`],
    ['+1-1', `"'+1-1"`],
    ['-1+1', `"'-1+1"`],
    ['@SUM(A1)', `"'@SUM(A1)"`],
    ['\t=x', `"'\t=x"`],
    ['\r=x', `"'\r=x"`],
    ['\n=x', `"'\n=x"`],
    // 선행 공백으로 감춘 수식 — 탐지는 공백을 무시하고, 값 자체는 보존한다.
    ['  =1+1', `"'  =1+1"`],
    // 방어 대상이 아닌 값에는 접두사가 붙지 않는다(거짓 양성 확인).
    ['1+1', '1+1'],
    ['계산=1+1', '계산=1+1'],
  ] as const;

  for (const [raw, expected] of hostile) {
    it(`${JSON.stringify(raw)} → ${JSON.stringify(expected)}`, () => {
      expect(toCsv([T('x')], [{ x: raw }])).toBe(`x\r\n${expected}`);
    });
  }

  it('접두사가 붙은 셀은 항상 인용한다 — 임포터가 필드 경계를 다시 나누지 못하게', () => {
    // 인용 없이 내보내면 선행 공백 트리밍·필드 재분할로 접두사가 첫 바이트 자리를 잃을 수 있다.
    expect(toCsv([T('x')], [{ x: '=1' }])).toBe(`x\r\n"'=1"`);
  });
});

describe('toCsv — number 열', () => {
  it('음수는 ASCII 하이픈 그대로 — 접두사도 인용도 없다', () => {
    expect(toCsv([N('a', '금액')], [{ a: -15000 }])).toBe('금액\r\n-15000');
    expect(toCsv([N('a', '금액')], [{ a: '-96000' }])).toBe('금액\r\n-96000');
  });

  it('0과 양수도 그대로', () => {
    expect(toCsv([N('a')], [{ a: 0 }])).toBe('a\r\n0');
    expect(toCsv([N('a')], [{ a: 20000 }])).toBe('a\r\n20000');
  });

  it('표시용 U+2212(−)는 ASCII 하이픈으로 정규화한다', () => {
    // lib/format.ts의 formatAmount가 U+2212를 찍기 때문에 이 실수는 현실적이다.
    // U+2212를 그대로 내보내면 스프레드시트가 숫자로 읽지 못하고 텍스트가 된다.
    expect(toCsv([N('a')], [{ a: '−15000' }])).toBe('a\r\n-15000');
  });

  it('null·undefined·빈 문자열은 빈 셀이다 — 0으로 바꾸지 않는다', () => {
    expect(toCsv([N('a'), N('b'), N('c')], [{ a: null, b: undefined, c: '  ' }])).toBe(
      'a,b,c\r\n,,',
    );
  });

  /**
   * 타입 인식 설계의 유일한 구멍을 막는다: 호출자가 **number 열에 텍스트를 넣는** 경우.
   * 열 타입은 선언이지 보증이 아니므로, 직렬화기가 값을 실제로 확인한다 —
   * 숫자가 아니면 text 레인으로 떨어뜨려 접두사 방어를 받게 한다. 어떤 경로로도
   * 수식이 무방비로 나가지 않는다.
   */
  it('number 열에 숫자가 아닌 값이 오면 text 레인으로 떨어뜨려 방어한다', () => {
    expect(toCsv([N('a')], [{ a: '=cmd|\' /C calc\'!A0' }])).toBe(`a\r\n"'=cmd|' /C calc'!A0"`);
    expect(toCsv([N('a')], [{ a: '-1+1' }])).toBe(`a\r\n"'-1+1"`);
    expect(toCsv([N('a')], [{ a: '1,000' }])).toBe('a\r\n"1,000"');
    expect(toCsv([N('a')], [{ a: Number.NaN }])).toBe('a\r\nNaN');
    expect(toCsv([N('a')], [{ a: -Number.POSITIVE_INFINITY }])).toBe(`a\r\n"'-Infinity"`);
  });

  it('소수와 bigint도 읽히는 형태로 나간다', () => {
    expect(toCsv([N('a')], [{ a: 1234.5 }])).toBe('a\r\n1234.5');
    // 리터럴 `10n`은 tsconfig target(ES2017)에서 막힌다 — BigInt()로 같은 값을 만든다.
    expect(toCsv([N('a')], [{ a: BigInt(10) }])).toBe('a\r\n10');
  });
});

describe('toCsvFile — BOM', () => {
  /**
   * BOM 없는 UTF-8 CSV를 Windows Excel이 열면 한글이 깨진다(cp949로 읽는다).
   * 현실에서 가장 흔히 터지는 실패이므로 **바이트로** 확인한다.
   */
  it('BOM으로 시작한다 — UTF-8 바이트 EF BB BF', () => {
    const body = toCsvFile([T('memo', '메모')], [{ memo: '코트 대관' }]);
    expect(body.startsWith(CSV_BOM)).toBe(true);
    expect([...Buffer.from(body, 'utf8').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // BOM 뒤는 toCsv와 한 글자도 다르지 않다 — 문법과 파일 인코딩을 섞지 않는다.
    expect(body.slice(1)).toBe(toCsv([T('memo', '메모')], [{ memo: '코트 대관' }]));
  });

  it('toCsv 자체에는 BOM이 없다 — 문법 테스트가 인코딩에 오염되지 않게', () => {
    expect(toCsv([T('a')], []).startsWith(CSV_BOM)).toBe(false);
  });
});

describe('파일명 — Content-Disposition', () => {
  it('파일명에 쓸 수 없는 문자를 걷어낸다', () => {
    expect(safeFilenamePart('농구 모임')).toBe('농구 모임');
    expect(safeFilenamePart('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(safeFilenamePart('줄\r\n바꿈\t탭')).toBe('줄 바꿈 탭');
    expect(safeFilenamePart('   ')).toBe('');
    expect(safeFilenamePart('가'.repeat(80)).length).toBe(40);
  });

  it('비ASCII 이름은 RFC 5987 filename*으로 싣고 ASCII 폴백을 함께 준다', () => {
    const v = attachmentDisposition('nbbang-농구-2026-09-15.csv', 'nbbang-2026-09-15.csv');
    expect(v).toBe(
      `attachment; filename="nbbang-2026-09-15.csv"; filename*=UTF-8''nbbang-%EB%86%8D%EA%B5%AC-2026-09-15.csv`,
    );
    // 헤더 값은 전부 ASCII여야 한다 — 아니면 런타임이 헤더를 거부한다.
    expect(/^[\x20-\x7e]*$/.test(v)).toBe(true);
  });

  it('따옴표·개행이 든 이름으로 헤더를 깨뜨릴 수 없다', () => {
    // 모임 이름은 사용자 입력이다 — 그대로 헤더에 넣으면 인용 탈출·헤더 주입 경로가 된다.
    const v = attachmentDisposition('a"b\r\nX-Evil: 1.csv', 'fallback.csv');
    expect(v).not.toContain('"a"b');
    expect(v).not.toContain('\r');
    expect(v).not.toContain('\n');
    expect(v).toContain('filename="fallback.csv"');
    expect(/^[\x20-\x7e]*$/.test(v)).toBe(true);
  });

  it("RFC 5987이 예약한 !'()* 까지 퍼센트 인코딩한다", () => {
    expect(attachmentDisposition("a'b(c).csv", 'f.csv')).toContain(
      "filename*=UTF-8''a%27b%28c%29.csv",
    );
  });
});
