import { BUSINESS_LIMITS } from '@shared/constants/limits';
import { roundCurrency } from '@shared/domain/money';
import { computePaymentFee } from '@shared/domain/payment-plugin-settings';
import { normalizeTierPricingRules, resolveEffectiveUnitPrice } from '@shared/domain/pricing';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentHostScope } from '../../api/http';
import { type CheckoutResult, ordersApi } from '../../api/orders.api';
import { storefrontApi } from '../../api/storefront.api';
import { fmt } from '../../i18n';
import { useStorefrontI18n } from '../../i18n/namespaces/storefront';
import { toast } from '../../lib/toast';
import type { BootstrapPayload, OrderRecord, PaymentIntentInfo, Product, UserProfile } from '../../types';
import { getStorefrontAgentRate } from './agent-pricing';

/** 统一在订单支付/交付后推送全局气泡提示，并附带「我的订单」或「查单」快捷入口 */
export function notifyOrderCompletionToast(
  order: OrderRecord,
  opts: {
    isSignedIn: boolean;
    sf: ReturnType<typeof useStorefrontI18n>;
  }
) {
  const { isSignedIn, sf } = opts;
  const orderNo = order.public_order_no || order.order_no;
  const action = {
    label: isSignedIn ? sf.checkoutViewMyOrders : sf.checkoutViewLookup,
    to: isSignedIn ? '/account/orders' : '/orders',
  };

  if (order.status === 'delivered') {
    const md = order.mail_delivery;
    if (md?.status === 'sent') {
      toast.success(fmt(sf.checkoutMailDeliveredToast, { orderNo, email: order.contact_email }), {
        durationMs: 6500,
        action,
      });
      return;
    }
    if (md?.status === 'pending') {
      toast.success(fmt(sf.checkoutMailQueuedToast, { orderNo, email: order.contact_email }), {
        durationMs: 6500,
        action,
      });
      return;
    }
    toast.success(fmt(sf.checkoutDoneNoMailToast, { orderNo }), { durationMs: 5500, action });
    if (md?.status === 'disabled') {
      toast.warning(sf.mailStatusDisabled, { durationMs: 6500, action });
    }
    return;
  }

  toast.info(fmt(sf.checkoutProcessingToast, { orderNo }), { durationMs: 6000, action });
}

/** 抽离商品详情页结账表单的计算定价、优惠券/推广金与提交状态逻辑 */
export function useProductCheckout({
  product,
  bootstrap,
  user,
  initialSpecId,
  accessCode,
  initialGroupBuyCode,
  onDelivered,
  onRequirePayment,
}: {
  product: Product;
  bootstrap: BootstrapPayload | null;
  user: UserProfile | null;
  initialSpecId?: string;
  accessCode?: string;
  initialGroupBuyCode?: string;
  onDelivered: (order: OrderRecord, balance?: number) => void;
  onRequirePayment: (intent: PaymentIntentInfo) => void;
}) {
  const sf = useStorefrontI18n();
  const qc = useQueryClient();
  const [selectedSpecId, setSelectedSpecId] = useState<string>(() => {
    if (initialSpecId && product.specs.some((s) => s.id === initialSpecId)) return initialSpecId;
    return product.specs[0]?.id || '';
  });
  const [groupBuyMode, setGroupBuyMode] = useState<'regular' | 'start' | 'join'>(() =>
    product.group_buy?.enabled && initialGroupBuyCode ? 'join' : 'regular'
  );
  const [groupBuyCode, setGroupBuyCode] = useState<string>(initialGroupBuyCode || '');
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [cardSelectFee, setCardSelectFee] = useState(0);
  const minBuyQty =
    groupBuyMode !== 'regular' || selectedCardId !== null
      ? 1
      : Math.max(1, Number(product.min_quantity || 1));
  const [quantity, setQuantity] = useState(minBuyQty);
  const [contactEmail, setContactEmail] = useState(user?.email || '');
  const [queryPassword, setQueryPassword] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>(__ACCTHUB_SANDBOX__ ? 'demo_instant' : '');
  const [usePromoBalance, setUsePromoBalance] = useState(false);
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const checkoutKey = `accthub.checkout.${getCurrentHostScope()}.${user?.id ?? 'guest'}.${product.id}`;
  const [canRecover, setCanRecover] = useState(() => Boolean(readCheckoutProof(checkoutKey)));
  const proofRef = useRef<{ scope: string; proof: CheckoutProof } | null>(null);
  const checkoutBusy = useRef(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileReset, setTurnstileReset] = useState(0);

  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    name: string;
    discount_amount: number;
  } | null>(null);
  const [couponError, setCouponError] = useState('');
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  const [restockEmail, setRestockEmail] = useState(user?.email || '');
  const [restockDoneMsg, setRestockDoneMsg] = useState('');
  const [restockLoading, setRestockLoading] = useState(false);

  useEffect(() => {
    if (product.specs.length > 0 && !product.specs.some((s) => s.id === selectedSpecId)) {
      setSelectedSpecId(product.specs[0].id);
    }
  }, [product.specs, selectedSpecId]);

  const userEmail = user?.email || '';
  useEffect(() => {
    if (!userEmail) return;
    setContactEmail((prev) => prev || userEmail);
    setRestockEmail((prev) => prev || userEmail);
  }, [userEmail]);

  const activeSpec = useMemo(
    () => product.specs.find((s) => s.id === selectedSpecId) || product.specs[0] || null,
    [product.specs, selectedSpecId]
  );

  const activeSpecStock = useMemo(() => {
    if (product.stock_mode === 'cards' && product.delivery_type !== 'api_key') {
      if (activeSpec && product.spec_stock) {
        const exact = product.spec_stock[activeSpec.id];
        if (typeof exact === 'number') return exact;
        if (product.specs.length <= 1 && typeof product.spec_stock.default === 'number') {
          return product.spec_stock.default;
        }
        return 0;
      }
    }
    return product.available_stock;
  }, [product, activeSpec]);

  const productMaxCap =
    Number(product.max_quantity || 0) > 0
      ? Math.min(BUSINESS_LIMITS.MAX_ORDER_QUANTITY, Number(product.max_quantity))
      : BUSINESS_LIMITS.MAX_ORDER_QUANTITY;
  const maxBuyQty =
    groupBuyMode !== 'regular' || selectedCardId !== null
      ? 1
      : Math.max(minBuyQty, Math.min(productMaxCap, activeSpecStock || productMaxCap));
  useEffect(() => {
    if (quantity < minBuyQty) setQuantity(minBuyQty);
    else if (activeSpecStock > 0 && quantity > maxBuyQty) setQuantity(maxBuyQty);
  }, [activeSpecStock, maxBuyQty, minBuyQty, quantity]);

  const agentRate = getStorefrontAgentRate(user, bootstrap?.tenant);
  const userIsAgent = agentRate !== null;
  const agentTier = userIsAgent ? user?.agent_tier : null;
  const retailUnitPrice = activeSpec ? activeSpec.price : product.price;
  const isSubAgentSite = Boolean(bootstrap?.tenant.isSubAgent);
  const tierRules = useMemo(
    () => (userIsAgent || !isSubAgentSite ? normalizeTierPricingRules(product.tier_pricing) : []),
    [product.tier_pricing, userIsAgent, isSubAgentSite]
  );

  const bulkTierUnitPrices = activeSpec?.bulk_tier_unit_prices ?? product.bulk_tier_unit_prices;
  const bulkBaseUnit = userIsAgent ? (activeSpec?.base_price ?? product.base_price) : retailUnitPrice;
  const unitEval = useMemo(() => {
    return resolveEffectiveUnitPrice({
      retailUnitPrice: bulkBaseUnit,
      quantity,
      tiers: tierRules,
      agentDiscountRate: agentRate,
      tierUnitPrices: bulkTierUnitPrices,
    });
  }, [agentRate, bulkBaseUnit, bulkTierUnitPrices, quantity, tierRules]);
  const bulkDisplayTiers = tierRules.map((tier) => {
    const unitPrice = bulkTierUnitPrices?.[tier.min_qty];
    return unitPrice === undefined || bulkBaseUnit <= 0
      ? tier
      : { ...tier, discount_rate: unitPrice / bulkBaseUnit };
  });

  const memberUnitCandidate =
    user && product.member_price && product.member_price > 0
      ? Math.min(unitEval.unitPrice, product.member_price)
      : unitEval.unitPrice;
  const unitPrice =
    groupBuyMode !== 'regular' && product.group_buy?.enabled && product.group_buy.price
      ? product.group_buy.price
      : memberUnitCandidate;
  const effectiveSelectFee = selectedCardId !== null && groupBuyMode === 'regular' ? cardSelectFee : 0;
  const preCouponTotal = Number((unitPrice * quantity + effectiveSelectFee).toFixed(2));
  const couponOff = appliedCoupon ? Math.min(preCouponTotal - 0.01, appliedCoupon.discount_amount) : 0;
  const payableAfterCoupon = Math.max(0.01, Number((preCouponTotal - couponOff).toFixed(2)));
  const isPrivateProduct = Boolean(
    product.is_private || (product.owner_agent_id && product.owner_agent_id > 0)
  );
  const availablePromo = isPrivateProduct ? 0 : Number(user?.promo_balance || 0);
  const promoUsedPreview =
    !isPrivateProduct && usePromoBalance && user && availablePromo >= 0.01
      ? Number(Math.min(payableAfterCoupon, availablePromo).toFixed(2))
      : 0;
  const totalAmount = Math.max(0, Number((payableAfterCoupon - promoUsedPreview).toFixed(2)));
  const totalSaved = Math.max(0, Number(((retailUnitPrice - unitPrice) * quantity + couponOff).toFixed(2)));
  const balanceInsufficient =
    paymentMethod === 'balance' && user && totalAmount > 0 && user.balance < totalAmount;

  useEffect(() => {
    void selectedSpecId;
    void quantity;
    setAppliedCoupon(null);
  }, [selectedSpecId, quantity]);

  const availablePayments = useMemo(() => {
    if (isPrivateProduct) {
      const own = bootstrap?.tenant_payment_methods ?? [];
      return own.length > 0
        ? own
        : (bootstrap?.payment_methods ?? []).filter((m) => Boolean(m.is_tenant_own));
    }
    return (bootstrap?.payment_methods ?? []).filter(
      (m) =>
        !m.is_tenant_own &&
        (m.id !== 'balance' || Boolean(user)) &&
        (__ACCTHUB_SANDBOX__ || !['demo_instant', 'alipay_demo', 'wechat_demo'].includes(m.id))
    );
  }, [bootstrap?.payment_methods, bootstrap?.tenant_payment_methods, isPrivateProduct, user]);

  const selectedPaymentObj = availablePayments.find((p) => p.id === paymentMethod) ?? null;
  const paymentFeeRatePct =
    paymentMethod === 'balance' || paymentMethod === 'demo_instant'
      ? 0
      : Number(selectedPaymentObj?.fee_rate_pct || 0);
  const paymentFeeAmount = computePaymentFee(totalAmount, paymentFeeRatePct);
  const payableWithFee = roundCurrency(totalAmount + paymentFeeAmount);

  useEffect(() => {
    setCanRecover(Boolean(readCheckoutProof(checkoutKey)));
  }, [checkoutKey]);

  useEffect(() => {
    if (availablePayments.length === 0) return;
    if (!availablePayments.some((p) => p.id === paymentMethod)) {
      // 优先默认选择已启用的真实在线收单网关，仅在无真实网关时回退内置演示收银台
      const preferred =
        availablePayments.find((p) => p.id !== 'balance' && p.id !== 'demo_instant') ||
        availablePayments.find((p) => p.id !== 'balance') ||
        availablePayments[0];
      setPaymentMethod(preferred.id);
    }
  }, [availablePayments, paymentMethod]);

  const handleApplyCoupon = async () => {
    if (!couponInput.trim()) return;
    setValidatingCoupon(true);
    setCouponError('');
    try {
      const res = await storefrontApi.validateCoupon(couponInput.trim(), preCouponTotal);
      setAppliedCoupon({
        code: res.coupon.code,
        name: res.coupon.name,
        discount_amount: res.discount_amount,
      });
      toast.success(
        fmt(sf.couponAppliedToast, {
          name: res.coupon.name,
          amount: res.discount_amount.toFixed(2),
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : sf.errCouponInvalid;
      setAppliedCoupon(null);
      setCouponError(msg);
      toast.error(msg, { alertRole: false });
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleRestockSubscribe = async () => {
    if (!restockEmail.trim()) return;
    setRestockLoading(true);
    setSubmitError('');
    try {
      const res = await storefrontApi.subscribeRestock({
        product_id: product.id,
        spec_id: activeSpec?.id,
        email: restockEmail.trim(),
      });
      setRestockDoneMsg(res.message);
      toast.success(res.message || fmt(sf.restockDoneToast, { email: restockEmail.trim() }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : sf.errSubscribeFailed;
      setSubmitError(msg);
      toast.error(msg, { alertRole: false });
    } finally {
      setRestockLoading(false);
    }
  };

  const getProof = () =>
    proofRef.current?.scope === checkoutKey ? proofRef.current.proof : readCheckoutProof(checkoutKey);

  const clearCheckout = () => {
    proofRef.current = null;
    saveCheckoutProof(checkoutKey, null);
    setCanRecover(false);
    setSubmitError('');
  };

  const acceptCheckout = (result: CheckoutResult) => {
    // 待付款的会话在关闭收银台和页面刷新后仍可恢复。
    if (!result.payment_intent || !['pending', 'paid'].includes(result.payment_intent.status)) {
      clearCheckout();
    }
    if (usePromoBalance || user) {
      void qc.invalidateQueries({ queryKey: ['account'] });
    }
    onDelivered(result.order, result.balance);
    if (result.payment_intent && ['pending', 'paid'].includes(result.payment_intent.status)) {
      onRequirePayment(result.payment_intent);
    } else {
      notifyOrderCompletionToast(result.order, {
        isSignedIn: Boolean(user),
        sf,
      });
    }
  };

  const handleRecoverCheckout = async () => {
    const proof = getProof();
    if (!proof || checkoutBusy.current) return;
    checkoutBusy.current = true;
    setSubmitting(true);
    setSubmitError('');
    toast.clearErrors();
    try {
      const result = await ordersApi.recoverCheckout(proof);
      if (result.found) acceptCheckout(result);
      else {
        setSubmitError(sf.checkoutNotFound);
        toast.error(sf.checkoutNotFound, { alertRole: false });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : sf.errOrderFailed;
      setSubmitError(msg);
      toast.error(msg, { alertRole: false });
    } finally {
      checkoutBusy.current = false;
      setSubmitting(false);
    }
  };

  const handleCheckout = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (checkoutBusy.current) return;
    const existingProof = getProof();
    if (!existingProof && activeSpecStock < quantity) {
      const msg = fmt(sf.errLowSpecStock, { stock: activeSpecStock });
      setSubmitError(msg);
      toast.error(msg, { alertRole: false });
      return;
    }
    if (!availablePayments.some((method) => method.id === paymentMethod)) {
      setSubmitError(sf.checkoutNoPayment);
      toast.error(sf.checkoutNoPayment, { alertRole: false });
      return;
    }
    checkoutBusy.current = true;
    setSubmitError('');
    toast.clearErrors();
    setSubmitting(true);
    const proof = existingProof ?? {
      idempotency_key: `ord_${crypto.randomUUID()}`,
      checkout_secret: Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join(''),
    };
    proofRef.current = { scope: checkoutKey, proof };
    saveCheckoutProof(checkoutKey, proof);
    setCanRecover(true);
    try {
      const res = await ordersApi.createOrder({
        product_id: product.id,
        spec_id: activeSpec?.id,
        quantity,
        contact_email: contactEmail,
        query_password: queryPassword,
        payment_method: paymentMethod,
        coupon_code: appliedCoupon?.code,
        use_promo_balance: usePromoBalance || undefined,
        custom_inputs: customInputs,
        ...proof,
        turnstile_token: !user && turnstileToken ? turnstileToken : undefined,
        access_code: accessCode?.trim() || undefined,
        group_buy_mode: groupBuyMode === 'regular' ? undefined : groupBuyMode,
        group_buy_code: groupBuyMode === 'join' ? groupBuyCode.trim() || undefined : undefined,
        selected_card_id: groupBuyMode === 'regular' && selectedCardId ? selectedCardId : undefined,
      });
      acceptCheckout(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : sf.errOrderFailed;
      setSubmitError(msg);
      toast.error(msg, { alertRole: false });
    } finally {
      checkoutBusy.current = false;
      setTurnstileToken('');
      setTurnstileReset((n) => n + 1);
      setSubmitting(false);
    }
  };

  return {
    selectedSpecId,
    setSelectedSpecId,
    groupBuyMode,
    groupBuyCode,
    selectGroupBuyMode: (nextMode: 'regular' | 'start' | 'join', code?: string) => {
      setGroupBuyMode(nextMode);
      if (nextMode === 'join' && code) setGroupBuyCode(code);
      if (nextMode !== 'regular') {
        setQuantity(1);
        setSelectedCardId(null);
        setCardSelectFee(0);
      }
    },
    selectedCardId,
    cardSelectFee: effectiveSelectFee,
    selectCard: (cardId: number | null, fee: number) => {
      setSelectedCardId(cardId);
      setCardSelectFee(cardId ? Math.max(0, fee) : 0);
      if (cardId !== null) setQuantity(1);
    },
    quantity,
    setQuantity,
    contactEmail,
    setContactEmail,
    queryPassword,
    setQueryPassword,
    paymentMethod,
    setPaymentMethod,
    usePromoBalance,
    setUsePromoBalance,
    customInputs,
    setCustomInputs,
    submitting,
    submitError,
    turnstileReset,
    setTurnstileToken,
    couponInput,
    setCouponInput,
    appliedCoupon,
    couponError,
    setCouponError,
    validatingCoupon,
    restockEmail,
    setRestockEmail,
    restockDoneMsg,
    restockLoading,
    activeSpec,
    activeSpecStock,
    minBuyQty,
    maxBuyQty,
    userIsAgent,
    agentTier,
    retailUnitPrice,
    tierRules,
    bulkDisplayTiers,
    unitEval,
    unitPrice,
    promoUsedPreview,
    totalAmount,
    paymentFeeRatePct,
    paymentFeeAmount,
    payableWithFee,
    totalSaved,
    balanceInsufficient,
    availablePayments,
    handleApplyCoupon,
    handleRestockSubscribe,
    handleCheckout,
    handleRecoverCheckout,
    startNewCheckout: () => !checkoutBusy.current && clearCheckout(),
    canRecover,
  };
}

type CheckoutProof = { idempotency_key: string; checkout_secret: string };

function readCheckoutProof(key: string): CheckoutProof | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(key) || 'null') as Partial<CheckoutProof> | null;
    if (!p?.idempotency_key || !/^[a-f0-9]{64}$/.test(p.checkout_secret ?? '')) return null;
    return { idempotency_key: p.idempotency_key, checkout_secret: p.checkout_secret as string };
  } catch {
    return null;
  }
}

function saveCheckoutProof(key: string, proof: CheckoutProof | null) {
  try {
    if (proof) sessionStorage.setItem(key, JSON.stringify(proof));
    else sessionStorage.removeItem(key);
  } catch {
    /* 忽略无痕模式或存储受限错误 */
  }
}
