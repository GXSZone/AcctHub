import { ListFilter } from 'lucide-react';
import { fmt } from '../../i18n';
import { useExtensionsI18n } from '../../i18n/namespaces/extensions';
import { useDisplayCurrency } from '../../lib/currency';
import { useSelectableCardsQuery } from '../../queries/extensions.queries';

interface CardSelectionPickerProps {
  productId: number;
  specId: string;
  enabled: boolean;
  selectedCardId: number | null;
  onSelect: (cardId: number | null, selectFee: number) => void;
}

export function CardSelectionPicker({
  productId,
  specId,
  enabled,
  selectedCardId,
  onSelect,
}: CardSelectionPickerProps) {
  const pc = useExtensionsI18n();
  const { formatMoneyFixed } = useDisplayCurrency();
  const query = useSelectableCardsQuery(productId, specId, enabled);
  const cards = query.data?.cards ?? [];

  if (!enabled || cards.length === 0) return null;

  return (
    <div
      className="rounded-2xl border p-3.5 space-y-2.5"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
    >
      <div className="text-xs font-semibold flex items-center gap-1.5">
        <ListFilter className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
        {pc.cardSelectTitle}
      </div>

      <select
        value={selectedCardId ?? ''}
        onChange={(e) => {
          const val = e.target.value;
          if (!val) {
            onSelect(null, 0);
            return;
          }
          const cid = Number(val);
          const found = cards.find((c) => c.id === cid);
          onSelect(cid, found?.select_fee ?? 0);
        }}
        className="acct-input text-xs"
      >
        <option value="">{pc.cardSelectRandomOpt}</option>
        {cards.map((card) => (
          <option key={card.id} value={card.id}>
            {card.public_label} —{' '}
            {card.select_fee > 0
              ? fmt(pc.cardSelectFeeTag, { fee: formatMoneyFixed(card.select_fee) })
              : pc.cardSelectFreeTag}
          </option>
        ))}
      </select>

      {selectedCardId && (
        <div className="text-[11px]" style={{ color: 'var(--accent)' }}>
          {pc.cardSelectSingleOnlyHint}
        </div>
      )}
    </div>
  );
}
