import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveSession } from '@/lib/session';
import { getGroupForMember, getSettlements } from '@/lib/db/queries';
import { formatDateKst } from '@/lib/format';
import { Amount } from '@/components/ui/amount';
import { buttonClasses } from '@/components/ui/button';
import { Cell, DataTable, Row } from '@/components/ui/data-table';
import { GroupTabs } from '@/components/ui/group-tabs';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/ui/text-link';

/**
 * 정산 목록 (F4). 열람은 모든 멤버, 만들기는 총무만 — 탭이 전원에게 보이는 이유다.
 *
 * 금액은 전부 tone='plain'이다. 정산 총액은 모임에 들어온 돈이 아니라 멤버들이 쓴 돈이고
 * (ADR-003: 정산은 원장 밖), 오렌지는 이 앱에서 '들어온 돈' 한 가지만 뜻한다.
 */
export default async function SettlePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  const session = await getActiveSession();
  if (!session) redirect(`/login?next=/groups/${groupId}/settle`);

  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) notFound();

  const isOwner = found.membership.role === 'owner';
  const list = await getSettlements(groupId);

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader back={`/groups/${groupId}`} title="정산" />
      <GroupTabs groupId={groupId} isOwner={isOwner} />

      {isOwner ? (
        <section className="border-b-2 border-ink py-7">
          <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
            새 정산
          </h2>
          <p className="mt-2 text-[13px] leading-[1.7] text-muted">
            한 사람이 먼저 낸 비용을 참여자끼리 나눕니다. 모임 잔액은 바뀌지 않습니다.
          </p>
          <div className="mt-4">
            {/* 다음 화면으로 가는 이동이므로 button이 아니라 링크다 — 스킨만 버튼에서 빌린다. */}
            <Link
              href={`/groups/${groupId}/settle/new`}
              data-testid="settlement-new"
              className={`${buttonClasses()} inline-block`}
            >
              정산 만들기
            </Link>
          </div>
        </section>
      ) : null}

      <section className="pt-7">
        <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
          정산 내역
        </h2>
        <div className="mt-4">
          <DataTable>
            {list.length === 0 ? (
              <Row>
                <Cell className="text-muted">
                  {isOwner ? '아직 정산이 없습니다. 위에서 만들어 보세요.' : '아직 정산이 없습니다.'}
                </Cell>
              </Row>
            ) : (
              list.map((s) => (
                <Row key={s.id} testId="settlement-row">
                  <Cell className="num w-[92px] align-top text-muted">
                    {formatDateKst(s.occurredAt)}
                  </Cell>
                  <Cell className="align-top">
                    <TextLink
                      href={`/groups/${groupId}/settle/${s.id}`}
                      data-testid="settlement-link"
                      className="font-bold"
                    >
                      {s.title}
                    </TextLink>
                  </Cell>
                  <Cell align="right" className="align-top">
                    <span data-testid="settlement-total">
                      <Amount value={s.total} size="md" unit tone="plain" />
                    </span>
                  </Cell>
                  <Cell align="right" className="w-[72px] align-top text-muted">
                    <span className="num" data-testid="settlement-participant-count">
                      {s.participantCount}
                    </span>
                    <span className="text-[12px]">명</span>
                  </Cell>
                </Row>
              ))
            )}
          </DataTable>
        </div>
      </section>
    </main>
  );
}
