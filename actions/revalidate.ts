import { revalidatePath } from 'next/cache';

/**
 * 금액이 하나라도 움직이면 그 돈을 보여주는 화면이 전부 함께 낡는다 — 한 번에 무효화한다.
 * 회비 화면도 포함한다: 납부는 원장 엔트리로 잔액을 움직이고, 회차 목록의 수납액도 같은 돈이다.
 *
 * 이 헬퍼가 actions/ledger.ts가 아니라 별 파일에 사는 이유: 'use server' 파일의 export는
 * 전부 async 함수여야 한다(그 외는 빌드 에러). 동기 헬퍼를 두 액션 파일이 공유하려면 밖으로 나와야 한다.
 */
export function revalidateLedger(groupId: string) {
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/expenses`);
  revalidatePath(`/groups/${groupId}/dues`);
}
