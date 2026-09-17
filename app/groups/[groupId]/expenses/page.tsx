import { notFound, redirect } from 'next/navigation';
import { getActiveSession } from '@/lib/session';
import { getExpenseEntries, getGroupForMember, type ExpenseEntry } from '@/lib/db/queries';
import { balanceOf } from '@/lib/domain/ledger';
import { formatDateKst } from '@/lib/format';
import { Amount } from '@/components/ui/amount';
import { Cell, DataTable, Row } from '@/components/ui/data-table';
import { GroupTabs } from '@/components/ui/group-tabs';
import { PageHeader } from '@/components/ui/page-header';
import ExpenseForm from './expense-form';
import ReverseButton from './reverse-button';

export default async function ExpensesPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  const session = await getActiveSession();
  if (!session) redirect(`/login?next=/groups/${groupId}/expenses`);

  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) notFound();

  const isOwner = found.membership.role === 'owner';
  const entries = await getExpenseEntries(groupId);

  // 정정(REVERSAL)은 별도 행이 아니라 원본 행에 접어 넣는다 (direction.md 화면 결정 Q3 = B).
  const reversals = new Map<string, ExpenseEntry>();
  for (const e of entries) {
    if (e.type === 'REVERSAL' && e.reversalOf) reversals.set(e.reversalOf, e);
  }
  const expenses = entries.filter((e) => e.type === 'EXPENSE');
  // 합계는 정정분까지 포함한 실지출 — 원본과 역분개가 서로 상쇄된다(ADR-001).
  const total = balanceOf(entries);

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader
        back={`/groups/${groupId}`}
        title="지출"
        right={
          <span className="text-right">
            <span className="font-display block text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
              지출 합계
            </span>
            <span data-testid="expense-total">
              <Amount value={total} size="lg" unit />
            </span>
          </span>
        }
      />
      <GroupTabs groupId={groupId} isOwner={isOwner} />

      {isOwner ? (
        <section className="border-b-2 border-ink py-7" data-testid="expense-form">
          <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">지출 기록</h2>
          <div className="mt-4">
            <ExpenseForm groupId={groupId} today={formatDateKst(new Date())} />
          </div>
        </section>
      ) : null}

      <section className="pt-7">
        <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
          지출 내역
        </h2>
        <div className="mt-4">
          <DataTable>
            {expenses.length === 0 ? (
              <Row>
                <Cell className="text-muted">아직 지출 기록이 없습니다.</Cell>
              </Row>
            ) : (
              expenses.map((e) => {
                const reversal = reversals.get(e.id);
                const struck = reversal ? 'text-muted line-through' : '';
                return (
                  <Row key={e.id} testId="expense-row">
                    <Cell className="num w-[92px] align-top text-muted">{formatDateKst(e.occurredAt)}</Cell>
                    <Cell className="align-top">
                      <span className={struck}>{e.memo ?? e.category ?? '지출'}</span>
                      {e.memo && e.category ? (
                        <span className={`ml-2 text-[12px] text-muted ${struck}`}>{e.category}</span>
                      ) : null}
                      {reversal ? (
                        <>
                          <span className="font-display ml-2 border border-ink px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-[0.1em]">
                            정정됨
                          </span>
                          {/* 투명성은 "항상 눈앞에"가 아니라 "언제든 확인 가능"으로 충분하다 — 펼치면 정정 기록. */}
                          <details className="mt-1.5" data-testid="expense-reversal">
                            <summary className="cursor-pointer text-[12px] text-muted">정정 기록</summary>
                            <p className="mt-1 flex items-baseline gap-2">
                              <span className="num text-[12px] text-muted">
                                {formatDateKst(reversal.occurredAt)}
                              </span>
                              <Amount value={reversal.amount} size="md" showSign />
                              <span className="text-[12px] text-muted">되돌림</span>
                            </p>
                          </details>
                        </>
                      ) : null}
                    </Cell>
                    <Cell align="right" className="align-top">
                      <span
                        data-testid="expense-amount"
                        className={reversal ? 'line-through opacity-45' : ''}
                      >
                        <Amount value={e.amount} size="md" showSign />
                      </span>
                      {/* 정정된 행은 뱃지가 그 자리를 대신한다 — 다시 정정할 수 없으니 버튼도 없다. */}
                      {isOwner && !reversal ? (
                        <div className="mt-1.5">
                          <ReverseButton groupId={groupId} entryId={e.id} />
                        </div>
                      ) : null}
                    </Cell>
                  </Row>
                );
              })
            )}
          </DataTable>
        </div>
      </section>
    </main>
  );
}
